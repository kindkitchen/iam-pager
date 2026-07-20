import { assertEquals, assertThrows } from "@std/assert";
import { DenoKvDatabaseSchemaManifestRepository } from "./deno-kv-manifest-repository.ts";
import { DenoKvSchemaUpgradeStateRepository } from "./deno-kv-state-repository.ts";
import type {
  DatabaseSchemaConnection,
  DatabaseSchemaConnectionFactory,
  DatabaseSchemaEnvironmentSource,
  DatabaseSchemaOutput,
} from "./pre-deploy.ts";
import {
  DENO_KV_ACCESS_TOKEN_ENV,
  parse_remote_database_schema_write_command,
  run_remote_database_schema_write_cli,
} from "./remote-upgrade.ts";

const database_url =
  "https://api.deno.com/v2/databases/123e4567-e89b-42d3-a456-426614174000/connect";

function environment(
  values: Readonly<Record<string, string>>,
): DatabaseSchemaEnvironmentSource {
  return { get: (name) => values[name] };
}

class RecordingOutput implements DatabaseSchemaOutput {
  readonly logs: string[] = [];
  readonly errors: string[] = [];
  log(line: string): void {
    this.logs.push(line);
  }
  error(line: string): void {
    this.errors.push(line);
  }
}

class SharedKvConnectionFactory implements DatabaseSchemaConnectionFactory {
  readonly kv: Deno.Kv;
  opened_paths: (string | undefined)[] = [];
  close_count = 0;

  constructor(kv: Deno.Kv) {
    this.kv = kv;
  }

  open(path?: string): Promise<DatabaseSchemaConnection> {
    this.opened_paths.push(path);
    return Promise.resolve({
      context: { kv: this.kv },
      manifest_repository: new DenoKvDatabaseSchemaManifestRepository(this.kv),
      state_repository: new DenoKvSchemaUpgradeStateRepository(this.kv),
      close: () => {
        this.close_count += 1;
      },
    });
  }
}

function command_args(project = "iam-pager"): string[] {
  return [
    `--database-url=${database_url}`,
    `--project=${project}`,
    "--from=sessions:0,pages:0,ownership:0",
    "--to=sessions:1,pages:1,ownership:1",
  ];
}

Deno.test("remote schema command parses exact URL, project, and sorted vectors", () => {
  assertEquals(parse_remote_database_schema_write_command(command_args()), {
    database_url,
    request: {
      project_id: "iam-pager",
      from_versions: [
        { schema_id: "ownership", version: 0 },
        { schema_id: "pages", version: 0 },
        { schema_id: "sessions", version: 0 },
      ],
      to_versions: [
        { schema_id: "ownership", version: 1 },
        { schema_id: "pages", version: 1 },
        { schema_id: "sessions", version: 1 },
      ],
    },
  });
});

Deno.test("remote schema command rejects ambiguous arguments and connector URLs", () => {
  const invalid_args = [
    command_args().slice(1),
    [...command_args(), "--project=iam-pager"],
    command_args().map((arg) =>
      arg.startsWith("--database-url=")
        ? "--database-url=https://example.com/v2/databases/123e4567-e89b-42d3-a456-426614174000/connect"
        : arg
    ),
    command_args().map((arg) =>
      arg.startsWith("--database-url=") ? `${arg}?token=secret` : arg
    ),
    command_args().map((arg) =>
      arg.startsWith("--from=") ? "--from=pages:01" : arg
    ),
    command_args().map((arg) => arg.startsWith("--to=") ? "--to=pages:0" : arg),
  ];

  for (const args of invalid_args) {
    assertThrows(() => parse_remote_database_schema_write_command(args));
  }
});

Deno.test("remote schema CLI bootstraps the explicitly selected database", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const factory = new SharedKvConnectionFactory(kv);
    const output = new RecordingOutput();
    const status = await run_remote_database_schema_write_cli(
      command_args(),
      environment({ [DENO_KV_ACCESS_TOKEN_ENV]: "remote-token" }),
      output,
      { database_factory: factory },
    );

    assertEquals(status, 0);
    assertEquals(factory.opened_paths, [database_url]);
    assertEquals(factory.close_count, 1);
    assertEquals(output.errors, []);
    assertEquals(
      output.logs.at(-1),
      "database-schema write project=iam-pager outcome=complete",
    );
    assertEquals(
      await new DenoKvDatabaseSchemaManifestRepository(kv).read_manifest(),
      {
        project_id: "iam-pager",
        schema_versions: [
          { schema_id: "ownership", version: 1 },
          { schema_id: "pages", version: 1 },
          { schema_id: "sessions", version: 1 },
        ],
      },
    );
  } finally {
    kv.close();
  }
});

Deno.test("remote schema CLI requires token and expected project before opening DB", async () => {
  for (
    const test_case of [
      {
        args: command_args(),
        environment: environment({}),
        code: "missing_access_token",
      },
      {
        args: command_args("other-project"),
        environment: environment({ [DENO_KV_ACCESS_TOKEN_ENV]: "secret" }),
        code: "wrong_project",
      },
    ]
  ) {
    const output = new RecordingOutput();
    let opened = false;
    const status = await run_remote_database_schema_write_cli(
      test_case.args,
      test_case.environment,
      output,
      {
        database_factory: {
          open: () => {
            opened = true;
            return Promise.reject(new Error("must not open"));
          },
        },
      },
    );
    assertEquals(status, 1);
    assertEquals(opened, false);
    assertEquals(output.logs, []);
    assertEquals(output.errors[0].includes(test_case.code), true);
    assertEquals(output.errors[0].includes("secret"), false);
    assertEquals(output.errors[0].includes(database_url), false);
  }
});

Deno.test("remote schema CLI refuses stale from-vector without touching DB", async () => {
  const kv = await Deno.openKv(":memory:");
  try {
    const manifest_repository = new DenoKvDatabaseSchemaManifestRepository(kv);
    const state_repository = new DenoKvSchemaUpgradeStateRepository(kv);
    await manifest_repository.initialize_manifest({
      project_id: "iam-pager",
      schema_versions: [
        { schema_id: "ownership", version: 1 },
        { schema_id: "pages", version: 1 },
        { schema_id: "sessions", version: 1 },
      ],
    });
    for (const schema_id of ["ownership", "pages", "sessions"]) {
      await state_repository.initialize_state({
        schema_id,
        baseline_version: 1,
      });
    }
    const before = await kv.get(["database-schema", "v1", "manifest"]);
    const output = new RecordingOutput();
    const status = await run_remote_database_schema_write_cli(
      command_args(),
      environment({ [DENO_KV_ACCESS_TOKEN_ENV]: "remote-token" }),
      output,
      { database_factory: new SharedKvConnectionFactory(kv) },
    );

    assertEquals(status, 1);
    assertEquals(output.errors, [
      "database-schema failed code=version_mismatch project=iam-pager",
    ]);
    assertEquals(
      (await kv.get(["database-schema", "v1", "manifest"])).versionstamp,
      before.versionstamp,
    );
  } finally {
    kv.close();
  }
});

import { assertEquals } from "@std/assert";
import type {
  DatabaseSchemaManifestRepository,
  DatabaseSchemaVersion,
} from "./interfaces.ts";

export interface DatabaseSchemaManifestRepositoryConformanceOptions {
  readonly name: string;
  readonly make_repository: () =>
    | DatabaseSchemaManifestRepository
    | Promise<DatabaseSchemaManifestRepository>;
  readonly teardown?: (
    repository: DatabaseSchemaManifestRepository,
  ) => void | Promise<void>;
}

const versions_v1: readonly DatabaseSchemaVersion[] = [
  { schema_id: "ownership", version: 1 },
  { schema_id: "pages", version: 1 },
  { schema_id: "sessions", version: 1 },
];

export function test_database_schema_manifest_repository_conformance(
  options: DatabaseSchemaManifestRepositoryConformanceOptions,
): void {
  const conformance_test = (
    label: string,
    run: (repository: DatabaseSchemaManifestRepository) => Promise<void>,
  ) => {
    Deno.test(`${options.name}: ${label}`, async () => {
      const repository = await options.make_repository();
      try {
        await run(repository);
      } finally {
        await options.teardown?.(repository);
      }
    });
  };

  conformance_test(
    "initializes an absent project manifest exactly once",
    async (
      repository,
    ) => {
      assertEquals(await repository.read_manifest(), null);
      assertEquals(
        await repository.initialize_manifest({
          project_id: "iam-pager",
          schema_versions: versions_v1,
        }),
        "applied",
      );
      assertEquals(
        await repository.initialize_manifest({
          project_id: "other-project",
          schema_versions: versions_v1,
        }),
        "conflict",
      );
      assertEquals(await repository.read_manifest(), {
        project_id: "iam-pager",
        schema_versions: versions_v1,
      });
    },
  );

  conformance_test("replaces only an exact expected manifest", async (
    repository,
  ) => {
    const current = {
      project_id: "iam-pager",
      schema_versions: versions_v1,
    } as const;
    const next = {
      project_id: "iam-pager",
      schema_versions: versions_v1.map((version) =>
        version.schema_id === "pages" ? { ...version, version: 2 } : version
      ),
    } as const;
    await repository.initialize_manifest(current);
    assertEquals(
      await repository.replace_manifest({
        expected_manifest: {
          project_id: "iam-pager",
          schema_versions: versions_v1.map((version) => ({
            ...version,
            version: 9,
          })),
        },
        manifest: next,
      }),
      "conflict",
    );
    assertEquals(
      await repository.replace_manifest({
        expected_manifest: current,
        manifest: next,
      }),
      "applied",
    );
    assertEquals(await repository.read_manifest(), next);
  });

  conformance_test("allows one concurrent initializer", async (repository) => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        repository.initialize_manifest({
          project_id: "iam-pager",
          schema_versions: versions_v1,
        })),
    );
    assertEquals(results.filter((result) => result === "applied").length, 1);
    assertEquals(results.filter((result) => result === "conflict").length, 7);
  });
}

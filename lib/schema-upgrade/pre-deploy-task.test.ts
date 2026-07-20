import { assert, assertEquals } from "@std/assert";
import deno_config from "../../deno.json" with { type: "json" };

interface TaskObject {
  readonly description?: string;
  readonly command?: string;
  readonly dependencies?: readonly string[];
}

function object_task(name: string): TaskObject {
  const task = (deno_config.tasks as Readonly<Record<string, unknown>>)[name];
  assert(typeof task === "object" && task !== null);
  return task as TaskObject;
}

Deno.test("developer verification stays in the local push task", () => {
  const verify = object_task("verify");
  assertEquals(verify.command, undefined);
  assertEquals(verify.dependencies, ["check", "test"]);

  const install = object_task("hooks:install");
  assert(install.command?.includes("scripts/git-hooks/install.ts"));
  assert(install.command?.includes("--allow-run=git"));
});

Deno.test("pre-deploy only reads attached database schema", () => {
  const pre_deploy = object_task("pre-deploy");
  assertEquals(pre_deploy.dependencies, undefined);
  assert(pre_deploy.command?.includes("scripts/pre-deploy/check-db-schema.ts"));
  assertEquals(pre_deploy.command?.includes("deno task check"), false);
  assertEquals(pre_deploy.command?.includes("deno task test"), false);
  assertEquals(pre_deploy.command?.includes("deno task build"), false);
  assertEquals(pre_deploy.command?.includes("upgrade"), false);
  assert(pre_deploy.command?.includes("DENO_KV_DEFAULT_PATH"));
  assert(pre_deploy.command?.includes("DENO_KV_ACCESS_TOKEN"));
  assert(pre_deploy.command?.includes("--allow-net"));
});

Deno.test("remote schema mutation is explicit and independent from deploy", () => {
  const upgrade = object_task("db-schema:upgrade");
  assertEquals(upgrade.dependencies, undefined);
  assert(upgrade.command?.includes("scripts/database/upgrade-db-schema.ts"));
  assert(upgrade.command?.includes("--allow-env=DENO_KV_ACCESS_TOKEN"));
  assert(upgrade.command?.includes("--allow-net"));
  assertEquals(upgrade.command?.includes("--allow-net="), false);
  assertEquals(upgrade.command?.includes("--allow-read"), false);
  assertEquals(upgrade.command?.includes("--allow-write"), false);
});

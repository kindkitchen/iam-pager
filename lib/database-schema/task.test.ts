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

Deno.test("pre-deploy remains a trivial informational placeholder", () => {
  const task = object_task("pre-deploy");
  assertEquals(task.dependencies, undefined);
  assert(task.command?.startsWith("echo "));
  assertEquals(task.command?.includes("deno run"), false);
  assertEquals(task.command?.includes("DENO_KV"), false);
  assertEquals(task.command?.includes("scripts/"), false);
});

Deno.test("database schema checks and updates are explicit manual tasks", () => {
  const check = object_task("db:check");
  const update = object_task("db:update");
  for (const task of [check, update]) {
    assert(task.command?.includes("scripts/database/schema.ts"));
    assert(task.command?.includes("DENO_KV_ACCESS_TOKEN"));
    assert(task.command?.includes("--allow-net"));
    assert(task.command?.includes("--allow-read"));
    assert(task.command?.includes("--allow-write"));
  }
  assert(check.command?.endsWith(" check"));
  assert(update.command?.endsWith(" update"));
});

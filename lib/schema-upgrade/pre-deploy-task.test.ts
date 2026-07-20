import { assert, assertEquals } from "@std/assert";
import deno_config from "../../deno.json" with { type: "json" };

interface TaskObject {
  readonly description?: string;
  readonly command?: string;
  readonly dependencies?: readonly string[];
  readonly files?: readonly string[];
}

function object_task(name: string): TaskObject {
  const task = (deno_config.tasks as Readonly<Record<string, unknown>>)[name];
  assert(typeof task === "object" && task !== null);
  return task as TaskObject;
}

Deno.test("pre-deploy task graph runs verification siblings before database upgrade", () => {
  const verification_tasks = [
    "pre-deploy::check",
    "pre-deploy::test",
    "pre-deploy::build",
  ] as const;
  const parent = object_task("pre-deploy");
  const upgrade = object_task("pre-deploy::upgrade-db-schema");

  assertEquals(parent.command, undefined);
  assertEquals(parent.dependencies, ["pre-deploy::upgrade-db-schema"]);
  assertEquals(upgrade.dependencies, verification_tasks);
  for (const task_name of verification_tasks) {
    const task = object_task(task_name);
    assert(typeof task.command === "string" && task.command.length > 0);
    assertEquals(task.dependencies, undefined);
  }

  // Deno runs sibling dependencies concurrently and skips a dependent command
  // when any dependency fails; this exact shape is therefore the deployment gate.
  assertEquals(upgrade.files, undefined);
  assert(upgrade.command?.includes("scripts/pre-deploy/upgrade-db-schema.ts"));
  assert(upgrade.command?.includes("--allow-env="));
  assert(upgrade.command?.includes("--allow-read"));
  assert(upgrade.command?.includes("--allow-write"));
  assertEquals(upgrade.command?.includes(" -A "), false);
  assertEquals(upgrade.dependencies?.includes("pre-deploy::*") ?? false, false);
});

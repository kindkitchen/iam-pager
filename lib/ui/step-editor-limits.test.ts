import { assertEquals } from "@std/assert";
import {
  DeterministicStepEditorLimits,
  guest_step_line_limit,
  member_step_line_limit,
  raisable_step_limit,
  step_editor_limits,
} from "./step-editor-limits.ts";

const limits = new DeterministicStepEditorLimits();

function draft(lines: number): string {
  return Array.from({ length: lines }, (_, index) => `line ${index}`).join(
    "\n",
  );
}

Deno.test("a signed-in creator gets twice the guest line budget", () => {
  assertEquals(guest_step_line_limit, 500);
  assertEquals(member_step_line_limit, 1000);
  assertEquals(limits.limit("guest"), guest_step_line_limit);
  assertEquals(limits.limit("member"), member_step_line_limit);
});

Deno.test("the budget is counted in physical lines", () => {
  assertEquals(limits.physical_lines(""), 1);
  assertEquals(limits.physical_lines("a\nb\nc"), 3);
  assertEquals(limits.physical_lines("trailing\n"), 2);
});

Deno.test("only a draft past its own budget is refused", () => {
  const guest_sized = draft(guest_step_line_limit);
  const between = draft(guest_step_line_limit + 1);
  const member_sized = draft(member_step_line_limit);
  const beyond = draft(member_step_line_limit + 1);

  assertEquals(limits.exceeded(guest_sized, "guest"), false);
  assertEquals(limits.exceeded(between, "guest"), true);
  // The same draft stays editable as steps for a signed-in creator.
  assertEquals(limits.exceeded(between, "member"), false);
  assertEquals(limits.exceeded(member_sized, "member"), false);
  assertEquals(limits.exceeded(beyond, "member"), true);
});

Deno.test("only a guest can raise the cap by signing in", () => {
  assertEquals(raisable_step_limit("guest"), true);
  assertEquals(raisable_step_limit("member"), false);
  assertEquals(step_editor_limits.limit("member"), member_step_line_limit);
});

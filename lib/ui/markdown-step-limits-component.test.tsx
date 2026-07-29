import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { MarkdownContentEditor } from "../../components/MarkdownContentEditor.tsx";
import type { PagePreviewer } from "./page-preview.ts";
import {
  guest_step_line_limit,
  member_step_line_limit,
  type StepEditorAccess,
} from "./step-editor-limits.ts";

const previewer: PagePreviewer = { render: () => "<html></html>" };

function editor(lines: number, access?: StepEditorAccess) {
  const markdown = Array.from({ length: lines }, (_, i) => `line ${i}`).join(
    "\n",
  );
  return render_to_string(
    <MarkdownContentEditor
      panel_id="p"
      label_id="l"
      markdown={markdown}
      css=""
      active
      initial_mode="steps"
      {...(access ? { access } : {})}
      on_markdown_input={() => {}}
      previewer={previewer}
    />,
  );
}

Deno.test("a guest draft past 500 lines falls back to Raw", () => {
  const within = editor(guest_step_line_limit, "guest");
  assertEquals(within.includes("markdown-limit-message"), false);
  assertStringIncludes(within, "markdown-sections");

  const beyond = editor(guest_step_line_limit + 1, "guest");
  assertStringIncludes(beyond, "markdown-limit-message");
  assertStringIncludes(beyond, `Steps is limited to ${guest_step_line_limit}`);
  assertStringIncludes(beyond, "Signed-in creators can use Steps");
});

Deno.test("the same draft keeps Steps for a signed-in creator up to 1000", () => {
  const between = editor(guest_step_line_limit + 1, "member");
  assertEquals(between.includes("markdown-limit-message"), false);

  const beyond = editor(member_step_line_limit + 1, "member");
  assertStringIncludes(beyond, `Steps is limited to ${member_step_line_limit}`);
  // Nothing left to unlock by signing in.
  assertEquals(beyond.includes("Signed-in creators can use Steps"), false);
});

Deno.test("an unstated seat is treated as a guest", () => {
  assertStringIncludes(
    editor(guest_step_line_limit + 1),
    `Steps is limited to ${guest_step_line_limit}`,
  );
});

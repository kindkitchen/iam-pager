/**
 * Line budget of the structured Steps mode.
 *
 * Steps re-parses the whole draft and renders one preview per section on every
 * change, so it is bounded by *physical lines* rather than by bytes. The bound
 * is a seat question, not a Markdown question: a signed-in creator edits pages
 * they own and keep, a guest is drafting one page in a session. Nothing here
 * knows about Preact, a session, or the DOM — a surface passes the access it
 * has already resolved.
 */

/** Who is editing, as far as the budget is concerned. */
export type StepEditorAccess = "guest" | "member";

export const guest_step_line_limit = 500;
export const member_step_line_limit = 1000;

/** Reading the budget; any policy (per plan, per page) can satisfy it. */
export interface StepEditorLimits {
  /** Lines the mode is capped at for this access. */
  limit(access: StepEditorAccess): number;
  /** Physical lines of a draft, counted the same way everywhere. */
  physical_lines(markdown: string): number;
  /** True while the draft is too long for the structured mode. */
  exceeded(markdown: string, access: StepEditorAccess): boolean;
}

export class DeterministicStepEditorLimits implements StepEditorLimits {
  limit(access: StepEditorAccess): number {
    return access === "member" ? member_step_line_limit : guest_step_line_limit;
  }

  physical_lines(markdown: string): number {
    return markdown.split("\n").length;
  }

  exceeded(markdown: string, access: StepEditorAccess): boolean {
    return this.physical_lines(markdown) > this.limit(access);
  }
}

/** Default implementation used by the editor surfaces. */
export const step_editor_limits: StepEditorLimits =
  new DeterministicStepEditorLimits();

/** True when signing in would raise the cap this draft ran into. */
export function raisable_step_limit(access: StepEditorAccess): boolean {
  return access === "guest";
}

/**
 * View model of the `/beta/**` feature-preview surface.
 *
 * The preview owns no persistence: it hands the step editor a starting
 * Markdown draft and the endpoint that expands official Google short links.
 * Keeping it here means the route stays a thin adapter and the surface can be
 * rendered by any front end.
 */

export interface BetaMapStepsPreview {
  readonly title: string;
  readonly summary: string;
  /** Path the visitor asked for, echoed so deep links stay explicit. */
  readonly path: string;
  readonly hints: readonly string[];
  readonly markdown: string;
  readonly expand_endpoint: string;
}

export const beta_expand_endpoint = "/beta/expand-link";

/** Starting draft: loose map steps, a plain step, and two framed routes. */
export const beta_map_steps_markdown = [
  "## Trip draft",
  "",
  "[Kyiv Zoo](https://www.google.com/maps/search/?api=1&query=Kyiv+Zoo)",
  "[Maidan Nezalezhnosti](https://www.google.com/maps/search/?api=1&query=50.4501,30.5234)",
  "",
  "Drag one map step onto another to frame them as stops.",
  "",
  "[Weekend run](https://www.google.com/maps/dir/?api=1&origin=Lviv&destination=Uzhhorod&waypoints=Stryi&travelmode=driving)",
  "[Straight to Bukovel](https://www.google.com/maps/dir/?api=1&destination=Bukovel)",
].join("\n");

const hints: readonly string[] = [
  "A map step is still a Markdown link: label plus URL, nothing new in the document.",
  "Drag a map step onto another map step: they do not merge as text, they frame into one ordered stop list.",
  "Inside a frame, drag a stop to reorder it, or drag it out to split it back into its own step.",
  "The route link is regenerated from the frame's top-to-bottom order; a missing origin means the Maps app starts from the current location.",
  "Arrow keys move a focused grip, so ordering works without a pointer.",
];

/** Presents the preview for one requested `/beta/**` path. */
export function beta_map_steps_preview(url: URL): BetaMapStepsPreview {
  return {
    title: "Map route steps",
    summary:
      "Preview of the Markdown step editor extended with Google Maps route steps. " +
      "Nothing here is published; the shipped editor is untouched.",
    path: url.pathname,
    hints,
    markdown: beta_map_steps_markdown,
    expand_endpoint: beta_expand_endpoint,
  };
}

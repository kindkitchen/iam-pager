import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { MarkdownContentEditor } from "../../components/MarkdownContentEditor.tsx";
import { StaticMapLinkResolver } from "./map-link-resolver.ts";
import type { PagePreviewer } from "./page-preview.ts";
import {
  default_step_editor_config,
  link_variant_simple,
  set_step_input_variant,
} from "./step-editor-config.ts";

const previewer: PagePreviewer = { render: () => "<html></html>" };
const alias = "https://maps.app.goo.gl/mjUzsCDvmMebA6ac9?g_st=ac";

// Blank lines separate sections, so the links are sections 1, 3 and 5.
const markdown = [
  "[Zoo](https://www.google.com/maps/search/?api=1&query=Kyiv+Zoo)",
  `[Spot](${alias})`,
  "[Docs](https://example.com)",
].join("\n\n");

function editor(options: {
  expansions?: Record<string, string | null>;
  simple?: boolean;
} = {}) {
  const config = options.simple
    ? set_step_input_variant(
      default_step_editor_config(),
      "link",
      link_variant_simple,
    )
    : default_step_editor_config();
  return render_to_string(
    <MarkdownContentEditor
      panel_id="p"
      label_id="l"
      markdown={markdown}
      css=""
      active
      initial_mode="steps"
      initial_step_config={config}
      link_resolver={new StaticMapLinkResolver(options.expansions ?? {})}
      on_markdown_input={() => {}}
      previewer={previewer}
    />,
  );
}

function occurrences(html: string, needle: string): number {
  return html.split(needle).length - 1;
}

// Preact serializes a `true` attribute value as the bare attribute.
const map_step_attribute = "data-map-step";
const pending_attribute = "data-map-pending";

Deno.test("a maps section is marked with the pin, a foreign link is not", () => {
  const html = editor();
  assertEquals(occurrences(html, map_step_attribute), 1);
  assertEquals(occurrences(html, 'class="google-maps-pin"'), 2);
  assertStringIncludes(html, "Section 1 is a Google Maps route");
  // The alias is not readable yet, so it is marked as being expanded.
  assertStringIncludes(html, pending_attribute);
  assertStringIncludes(
    html,
    "Expanding the Google Maps short link of section 3",
  );
});

Deno.test("an expanded alias becomes a map section like any other", () => {
  const html = editor({
    expansions: {
      [alias]: "https://www.google.com/maps/place/City+of+Whittlesea/data=" +
        "!3d-37.6187516!4d144.963937",
    },
  });
  assertEquals(occurrences(html, map_step_attribute), 2);
  assertEquals(occurrences(html, pending_attribute), 0);
  assertStringIncludes(html, "Section 3 is a Google Maps route");
});

Deno.test("the simple link variant shows no map marking at all", () => {
  const html = editor({ simple: true });
  assertEquals(occurrences(html, map_step_attribute), 0);
  assertEquals(occurrences(html, "google-maps-pin"), 0);
});

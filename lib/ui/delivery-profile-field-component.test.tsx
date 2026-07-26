import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { DeliveryProfileField } from "../../components/DeliveryProfileField.tsx";

Deno.test("delivery field offers both profiles explicitly, never a bare checkbox", () => {
  const html = render_to_string(
    <DeliveryProfileField
      name="managed-delivery-profile-0"
      value="attachment"
      on_change={() => {}}
    />,
  );

  assertStringIncludes(html, "<legend>Delivery</legend>");
  assertStringIncludes(html, 'name="managed-delivery-profile-0"');
  assertStringIncludes(html, 'value="inline"');
  assertStringIncludes(html, 'value="attachment" checked');
  assertStringIncludes(html, "Open in browser");
  assertStringIncludes(html, "Visitors get a file download at this path.");
  assertStringIncludes(html, "choice-option");
  assertEquals(html.includes('type="checkbox"'), false);
  assertEquals(html.includes("Downloadable"), false);
});

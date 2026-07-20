import { assertEquals, assertStringIncludes } from "@std/assert";
import { render as render_to_string } from "preact-render-to-string";
import { PdfFileSelection } from "../../components/PdfFileSelection.tsx";
import { pdf_file_selection_presenter } from "./pdf-file-selection.ts";

Deno.test("empty picker renders accept filter and hint without advisory", () => {
  const html = render_to_string(
    <PdfFileSelection view={pdf_file_selection_presenter.present(null)} />,
  );
  assertStringIncludes(html, 'type="file"');
  assertStringIncludes(html, 'accept="application/pdf,.pdf"');
  assertStringIncludes(html, "Choose a PDF up to 16 MiB.");
  assertEquals(html.includes('role="alert"'), false);
  assertEquals(html.includes("aria-invalid"), false);
});

Deno.test("valid selection shows filename and size feedback", () => {
  const html = render_to_string(
    <PdfFileSelection
      view={pdf_file_selection_presenter.present({
        filename: "report.pdf",
        size_bytes: 1_468_006,
        media_type: "application/pdf",
      })}
    />,
  );
  assertStringIncludes(html, "report.pdf");
  assertStringIncludes(html, "1.4 MiB");
  assertEquals(html.includes('role="alert"'), false);
});

Deno.test("advisory selection marks the input invalid and alerts", () => {
  const html = render_to_string(
    <PdfFileSelection
      view={pdf_file_selection_presenter.present({
        filename: "report.pdf",
        size_bytes: 32 * 1024 * 1024,
        media_type: "application/pdf",
      })}
      required
    />,
  );
  assertStringIncludes(html, "required");
  assertStringIncludes(html, 'aria-invalid="true"');
  assertStringIncludes(
    html,
    'aria-describedby="pdf-file-feedback pdf-file-advisory"',
  );
  assertStringIncludes(html, 'role="alert"');
  assertStringIncludes(html, "selected PDF exceeds 16 MiB");
});

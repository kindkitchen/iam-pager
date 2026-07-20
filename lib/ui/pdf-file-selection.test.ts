import { assertEquals, assertThrows } from "@std/assert";
import {
  BoundedPdfFileSelectionPresenter,
  describe_pdf_file,
  format_byte_size,
  pdf_file_accept,
  pdf_file_selection_advisory,
  pdf_file_selection_presenter,
} from "./pdf-file-selection.ts";

Deno.test("describe_pdf_file maps a picked file without DOM assumptions", () => {
  const file = new File([new Uint8Array([1, 2, 3])], "report.pdf", {
    type: "application/pdf",
  });
  assertEquals(describe_pdf_file(file), {
    filename: "report.pdf",
    size_bytes: 3,
    media_type: "application/pdf",
  });
});

Deno.test("empty selection exposes accept, hint, and no advisory", () => {
  const view = pdf_file_selection_presenter.present(null);
  assertEquals(view.has_selection, false);
  assertEquals(view.filename, null);
  assertEquals(view.size_label, null);
  assertEquals(view.advisory, null);
  assertEquals(view.accept, pdf_file_accept);
  assertEquals(view.hint, "Choose a PDF up to 16 MiB.");
});

Deno.test("valid selection reports filename and size feedback", () => {
  const view = pdf_file_selection_presenter.present({
    filename: "report.pdf",
    size_bytes: 1_468_006,
    media_type: "application/pdf",
  });
  assertEquals(view.has_selection, true);
  assertEquals(view.filename, "report.pdf");
  assertEquals(view.size_label, "1.4 MiB");
  assertEquals(view.advisory, null);
});

Deno.test("advisory guides without replacing server authority", () => {
  assertEquals(
    pdf_file_selection_advisory({
      filename: "report.pdf",
      size_bytes: 0,
      media_type: "application/pdf",
    }),
    "selected file is empty",
  );
  assertEquals(
    pdf_file_selection_advisory({
      filename: "report.pdf",
      size_bytes: 32 * 1024 * 1024,
      media_type: "application/pdf",
    }),
    "selected PDF exceeds 16 MiB",
  );
  assertEquals(
    pdf_file_selection_advisory({
      filename: "bad/name.pdf",
      size_bytes: 1024,
      media_type: "application/pdf",
    }),
    "filename contains unsafe characters",
  );
  assertEquals(
    pdf_file_selection_advisory({
      filename: "report.pdf",
      size_bytes: 1024,
      media_type: "text/plain",
    }),
    "selected file is not reported as a PDF",
  );
  assertEquals(
    pdf_file_selection_advisory({
      filename: "report.pdf",
      size_bytes: 1024,
      media_type: "",
    }),
    null,
  );
});

Deno.test("presenter limits are configurable and bound the advisory", () => {
  const presenter = new BoundedPdfFileSelectionPresenter({
    limits: { max_bytes: 1024 },
  });
  const view = presenter.present({
    filename: "report.pdf",
    size_bytes: 2048,
    media_type: "application/pdf",
  });
  assertEquals(view.max_bytes, 1024);
  assertEquals(view.hint, "Choose a PDF up to 1 KiB.");
  assertEquals(view.advisory, "selected PDF exceeds 1 KiB");
});

Deno.test("format_byte_size renders bounded human-readable sizes", () => {
  assertEquals(format_byte_size(0), "0 B");
  assertEquals(format_byte_size(512), "512 B");
  assertEquals(format_byte_size(1024), "1 KiB");
  assertEquals(format_byte_size(16 * 1024 * 1024), "16 MiB");
  assertThrows(() => format_byte_size(-1));
  assertThrows(() =>
    new BoundedPdfFileSelectionPresenter({ limits: { max_bytes: 0 } })
  );
});

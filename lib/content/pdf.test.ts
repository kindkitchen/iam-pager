import { assert, assertEquals, assertFalse, assertThrows } from "@std/assert";
import {
  max_pdf_filename_bytes,
  pdf_media_type,
  PdfHandler,
  supported_pdf_versions,
} from "./pdf.ts";

const text_encoder = new TextEncoder();
const text_decoder = new TextDecoder();

function pdf_bytes(
  version = "1.7",
  marker = "fixture",
  advertised_xref_offset?: number,
): Uint8Array {
  const before_xref = `%PDF-${version}\n` +
    `1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n` +
    `2 0 obj\n<< /Type /Pages /Kids [] /Count 0 >>\nendobj\n` +
    `% ${marker}\n`;
  const xref_offset = text_encoder.encode(before_xref).byteLength;
  const tail = `xref\n0 3\n` +
    `0000000000 65535 f \n` +
    `0000000009 00000 n \n` +
    `0000000062 00000 n \n` +
    `trailer\n<< /Size 3 /Root 1 0 R >>\n` +
    `startxref\n${advertised_xref_offset ?? xref_offset}\n%%EOF\n`;
  return text_encoder.encode(before_xref + tail);
}

function xref_stream_pdf_bytes(): Uint8Array {
  const prefix = `%PDF-1.7\n` +
    `1 0 obj\n<< /Type /Catalog >>\nendobj\n`;
  const xref_offset = text_encoder.encode(prefix).byteLength;
  return text_encoder.encode(
    prefix +
      `2 0 obj\n` +
      `<< /Type /XRef /Size 3 /W [1 2 1] /Length 0 >>\n` +
      `stream\n\nendstream\nendobj\n` +
      `startxref\n${xref_offset}\n%%EOF\n`,
  );
}

Deno.test("pdf declares explicit content and delivery profiles", () => {
  const handler = new PdfHandler();
  assertEquals(handler.content_type, "pdf");
  assertEquals(handler.supported_delivery_profiles, ["inline", "attachment"]);
});

Deno.test("pdf limits must be positive safe integers", () => {
  for (const max_bytes of [0, -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
    assertThrows(
      () => new PdfHandler({ max_bytes }),
      Error,
      "positive safe integer",
    );
  }
});

Deno.test("pdf validation requires bounded Uint8Array input", () => {
  const bytes = pdf_bytes();
  const handler = new PdfHandler({ max_bytes: bytes.byteLength });
  for (const input of [null, undefined, [], "pdf", 1]) {
    assertEquals(handler.validate(input), {
      ok: false,
      reason: "input must be an object",
    });
  }
  for (const invalid_bytes of [undefined, "bytes", [], bytes.buffer]) {
    assertEquals(
      handler.validate({ bytes: invalid_bytes, filename: "report.pdf" }),
      { ok: false, reason: "bytes must be a Uint8Array" },
    );
  }
  assert(handler.validate({ bytes, filename: "report.pdf" }).ok);
  assertEquals(
    new PdfHandler({ max_bytes: bytes.byteLength - 1 }).validate({
      bytes,
      filename: "report.pdf",
    }),
    {
      ok: false,
      reason: `pdf exceeds ${bytes.byteLength - 1} bytes`,
    },
  );
  assertEquals(
    handler.validate({ bytes: new Uint8Array(), filename: "report.pdf" }),
    { ok: false, reason: "bytes must not be empty" },
  );
});

Deno.test("pdf validation accepts only explicit supported headers at byte zero", () => {
  const handler = new PdfHandler();
  for (const version of supported_pdf_versions) {
    assert(
      handler.validate({ bytes: pdf_bytes(version), filename: "report" }).ok,
      `expected PDF ${version} to be accepted`,
    );
  }
  for (const version of ["0.9", "1.8", "2.1", "3.0"]) {
    assertEquals(
      handler.validate({ bytes: pdf_bytes(version), filename: "report.pdf" }),
      {
        ok: false,
        reason: "bytes must begin with a supported PDF header (1.0-1.7 or 2.0)",
      },
    );
  }
  const prefixed = new Uint8Array([0x20, ...pdf_bytes()]);
  assertEquals(handler.validate({ bytes: prefixed, filename: "report.pdf" }), {
    ok: false,
    reason: "bytes must begin with a supported PDF header (1.0-1.7 or 2.0)",
  });
});

Deno.test("pdf validation requires a terminal startxref target and EOF marker", () => {
  const handler = new PdfHandler();
  const valid = pdf_bytes();
  assert(
    handler.validate({
      bytes: xref_stream_pdf_bytes(),
      filename: "stream.pdf",
    }).ok,
  );
  const without_startxref = text_encoder.encode(
    text_decoder.decode(valid).replace("startxref", "start-ref"),
  );
  const without_eof = text_encoder.encode(
    text_decoder.decode(valid).replace("%%EOF", "%%END"),
  );
  const trailing_payload = new Uint8Array([
    ...valid,
    ...text_encoder.encode("x"),
  ]);
  for (
    const bytes of [
      without_startxref,
      without_eof,
      trailing_payload,
      pdf_bytes("1.7", "fixture", 0),
      pdf_bytes("1.7", "fixture", 9),
      pdf_bytes("1.7", "fixture", 10_000),
    ]
  ) {
    assertEquals(handler.validate({ bytes, filename: "report.pdf" }), {
      ok: false,
      reason: "bytes must end with a valid PDF startxref/%%EOF structure",
    });
  }
});

Deno.test("pdf validation enforces portable safe filename metadata", () => {
  const handler = new PdfHandler();
  const bytes = pdf_bytes();
  for (const filename of ["report", "résumé 2026.pdf", "資料.pdf"]) {
    assert(handler.validate({ bytes, filename }).ok);
  }
  for (
    const filename of [
      "",
      " report.pdf",
      "report.pdf ",
      "report.",
      "../report.pdf",
      "folder/report.pdf",
      "folder\\report.pdf",
      "report\n.pdf",
      "report?.pdf",
      "CON.pdf",
      "lpt9",
      "line\u2028break.pdf",
      "safe\u200Ename.pdf",
      "safe\u202Efdp.exe",
    ]
  ) {
    const result = handler.validate({ bytes, filename });
    assertFalse(result.ok, `expected ${JSON.stringify(filename)} to fail`);
  }
  const oversized_filename = "é".repeat(max_pdf_filename_bytes) + ".pdf";
  assertEquals(handler.validate({ bytes, filename: oversized_filename }), {
    ok: false,
    reason: `filename exceeds ${max_pdf_filename_bytes} UTF-8 bytes`,
  });
});

Deno.test("pdf validation and derivation detach accepted immutable bytes", () => {
  const original = pdf_bytes("1.6");
  const expected = original.slice();
  const handler = new PdfHandler();
  const validated = handler.validate({
    bytes: original,
    filename: "report.not-trusted",
    media_type: "text/html",
  });
  assert(validated.ok);
  original.fill(0);
  assertEquals(validated.value.bytes, expected);
  assertEquals(validated.value.filename, "report.not-trusted");
  assertEquals(Object.keys(validated.value), ["bytes", "filename"]);

  const data = handler.derive(validated.value);
  validated.value.bytes.fill(1);
  assertEquals(data.bytes, expected);
  assertEquals(data.pdf_version, "1.6");
});

Deno.test("pdf management projection is bounded metadata without bytes", () => {
  const handler = new PdfHandler();
  const bytes = pdf_bytes("2.0");
  const validated = handler.validate({ bytes, filename: "report.pdf" });
  assert(validated.ok);
  const management = handler.to_management(handler.derive(validated.value));
  assertEquals(management, {
    filename: "report.pdf",
    media_type: pdf_media_type,
    size_bytes: bytes.byteLength,
    pdf_version: "2.0",
    replaceable: true,
  });
  assertFalse("bytes" in management);
});

Deno.test("pdf rendering fixes media type and returns detached exact bytes", () => {
  const handler = new PdfHandler();
  const bytes = pdf_bytes("1.7");
  const validated = handler.validate({ bytes, filename: "report.txt" });
  assert(validated.ok);
  const data = handler.derive(validated.value);
  const first = handler.render(data);
  assertEquals(first.media_type, pdf_media_type);
  assertEquals(first.download_filename, "report.txt");
  assertEquals(first.body, bytes);
  (first.body as Uint8Array).fill(0);
  assertEquals(handler.render(data).body, bytes);
});

import { assert, assertEquals } from "@std/assert";
import { WebPdfMultipartDecoder } from "../page/pdf-http.ts";
import {
  page_content_type_options,
  pdf_delivery_profile_options,
  pdf_publish_draft_violation,
  type PdfPublishDraft,
  prepare_pdf_publish_request,
} from "./page-content-type.ts";

function draft(overrides: Partial<PdfPublishDraft> = {}): PdfPublishDraft {
  return {
    filename: "report.pdf",
    bytes: new Uint8Array([1, 2, 3, 4]),
    access: "public",
    canonical: {
      namespace: "alice",
      page_name: "report",
      delivery_profile: "inline",
    },
    alternates: [
      {
        namespace: "alice",
        page_name: "report/download",
        delivery_profile: "attachment",
      },
    ],
    tags: [],
    ...overrides,
  };
}

Deno.test("content and PDF delivery options stay explicit and UI-independent", () => {
  assertEquals(page_content_type_options.map((option) => option.value), [
    "md-page",
    "pdf",
  ]);
  assertEquals(pdf_delivery_profile_options.map((option) => option.value), [
    "inline",
    "attachment",
  ]);
});

Deno.test("prepared pdf request omits content-type and adds creator CSRF", () => {
  const prepared = prepare_pdf_publish_request(draft(), {
    kind: "creator",
    csrf_token: "creator-csrf",
  });
  assertEquals(prepared.url, "/api/pages");
  assertEquals(prepared.method, "POST");
  assertEquals(prepared.headers.get("content-type"), null);
  assertEquals(prepared.headers.get("x-csrf-token"), "creator-csrf");

  const guest = prepare_pdf_publish_request(draft(), { kind: "guest" });
  assertEquals(guest.headers.get("x-csrf-token"), null);
});

Deno.test("prepared pdf request is accepted by the real multipart create contract", async () => {
  const prepared = prepare_pdf_publish_request(
    draft({ tags: ["docs"] }),
    { kind: "creator", csrf_token: "creator-csrf" },
  );
  const request = new Request("https://example.test/api/pages", {
    method: prepared.method,
    headers: prepared.headers,
    body: prepared.form_data,
  });

  const decoded = await new WebPdfMultipartDecoder().decode_create(request);
  assert(decoded.ok, decoded.ok ? "" : decoded.detail);
  assertEquals(decoded.value.access, "public");
  assertEquals(decoded.value.tags, ["docs"]);
  assertEquals(decoded.value.content.content_type, "pdf");
  assertEquals(decoded.value.content.input.filename, "report.pdf");
  assertEquals([...decoded.value.content.input.bytes], [1, 2, 3, 4]);
  assertEquals(decoded.value.endpoint_set.canonical.delivery_profile, "inline");
  assertEquals(decoded.value.endpoint_set.canonical.locator, {
    namespace: "alice",
    page_name: "report",
  });
  assert(
    (decoded.value.endpoint_set.alternates ?? []).some(
      (endpoint) => endpoint.delivery_profile === "attachment",
    ),
  );
});

Deno.test("endpoint drafts drop empty page names to address the default page", async () => {
  const prepared = prepare_pdf_publish_request(
    draft({
      canonical: {
        namespace: " alice ",
        page_name: "  ",
        delivery_profile: "inline",
      },
    }),
    { kind: "guest" },
  );
  const metadata = prepared.form_data.get("metadata");
  assert(metadata instanceof File);
  const parsed = JSON.parse(await metadata.text());
  assertEquals(parsed.endpoint_set.canonical.locator, { namespace: "alice" });
});

Deno.test("advisory violation guides without replacing server authority", () => {
  assertEquals(pdf_publish_draft_violation(draft()), null);
  assertEquals(
    pdf_publish_draft_violation(draft({ bytes: new Uint8Array() })),
    "select a PDF file to publish",
  );
  assertEquals(
    pdf_publish_draft_violation(draft({ filename: "bad/name.pdf" })),
    "filename contains unsafe characters",
  );
  assertEquals(
    pdf_publish_draft_violation(
      draft({
        canonical: {
          namespace: "alice",
          page_name: "report",
          delivery_profile: "attachment",
        },
      }),
    ),
    "the canonical endpoint must deliver the PDF inline",
  );
  assertEquals(
    pdf_publish_draft_violation(draft({
      alternates: [{
        namespace: "other",
        page_name: "report/download",
        delivery_profile: "attachment",
      }],
    })),
    "each PDF endpoint must use the canonical namespace",
  );
  assertEquals(
    pdf_publish_draft_violation(draft({
      alternates: [{
        namespace: "ALICE",
        page_name: "REPORT",
        delivery_profile: "attachment",
      }],
    })),
    "each PDF endpoint needs a unique locator",
  );
  assertEquals(
    pdf_publish_draft_violation(draft({ alternates: [] })),
    "add an attachment endpoint so the PDF can be downloaded",
  );
});

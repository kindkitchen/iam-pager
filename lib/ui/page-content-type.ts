import type { DeliveryProfile } from "../content/model.ts";
import { is_valid_delivery_profile } from "../content/model.ts";
import { default_pdf_limits, pdf_filename_violation } from "../content/pdf.ts";
import type { Locator } from "../locator/model.ts";
import type { PageAccess } from "../page/model.ts";
import type { PageEndpointBinding } from "../page/endpoint.ts";
import { max_page_endpoints } from "../page/endpoint.ts";
import type { PagePublishAuthorization } from "./page-publish.ts";

/** The publishable content types the site can offer at a locator. */
export type PageContentType = "md-page" | "pdf";

/** One selectable content type, presented to the chooser without UI logic. */
export interface PageContentTypeOption {
  readonly value: PageContentType;
  readonly label: string;
  readonly description: string;
}

/**
 * Pure selector model. Components render these options and report the chosen
 * value; they never infer a type from a filename, suffix, or byte inspection.
 */
export const page_content_type_options: readonly PageContentTypeOption[] = [
  {
    value: "md-page",
    label: "Markdown page",
    description: "Write and style a page in Markdown.",
  },
  {
    value: "pdf",
    label: "PDF document",
    description: "Publish a PDF at ordinary endpoints you configure.",
  },
];

/**
 * One user-configured endpoint row: an ordinary locator plus a chosen delivery
 * profile. No suffix is special and no locator is auto-generated; the server
 * remains the sole authority over what a valid endpoint set is.
 */
export interface PdfEndpointDraft {
  readonly namespace: string;
  readonly page_name: string;
  readonly delivery_profile: DeliveryProfile;
}

/** Editable PDF publish intent collected by the UI before server validation. */
export interface PdfPublishDraft {
  readonly filename: string;
  readonly bytes: Uint8Array;
  readonly access: PageAccess;
  readonly canonical: PdfEndpointDraft;
  readonly alternates: readonly PdfEndpointDraft[];
  readonly tags: readonly string[];
}

/**
 * Prepared multipart request the island sends with `fetch`. The content-type
 * header is intentionally absent so the runtime derives the multipart boundary.
 */
export interface PreparedPdfPublishRequest {
  readonly url: string;
  readonly method: "POST";
  readonly headers: Headers;
  readonly form_data: FormData;
}

interface PdfCreateMetadata {
  readonly endpoint_set: {
    readonly canonical: PageEndpointBinding;
    readonly alternates: readonly PageEndpointBinding[];
  };
  readonly access: PageAccess;
  readonly tags?: readonly string[];
}

const pdf_publish_url = "/api/pages";
const pdf_media_type = "application/pdf";
const pdf_metadata_media_type = "application/json";
const pdf_metadata_part_filename = "metadata.json";

/**
 * Maps editable PDF intent onto the accepted strict multipart create contract:
 * one `metadata.json` part and one `application/pdf` file part. Endpoint
 * locators and profiles pass through untouched; the browser never invents or
 * interprets them.
 */
export function prepare_pdf_publish_request(
  draft: PdfPublishDraft,
  authorization: PagePublishAuthorization,
): PreparedPdfPublishRequest {
  const metadata: PdfCreateMetadata = {
    endpoint_set: {
      canonical: endpoint_binding(draft.canonical),
      alternates: draft.alternates.map(endpoint_binding),
    },
    access: draft.access,
    ...(draft.tags.length === 0 ? {} : { tags: [...draft.tags] }),
  };

  const headers = new Headers();
  if (authorization.kind === "creator") {
    headers.set("x-csrf-token", authorization.csrf_token);
  }

  const form_data = new FormData();
  form_data.append(
    "metadata",
    new File([JSON.stringify(metadata)], pdf_metadata_part_filename, {
      type: pdf_metadata_media_type,
    }),
  );
  form_data.append(
    "file",
    new File([draft.bytes as BlobPart], draft.filename, {
      type: pdf_media_type,
    }),
  );

  return { url: pdf_publish_url, method: "POST", headers, form_data };
}

/**
 * First advisory reason the PDF draft is not yet submittable, or null. This is
 * guidance only: the server re-validates bytes, filename, endpoints, access,
 * and tags and remains the sole authority.
 */
export function pdf_publish_draft_violation(
  draft: PdfPublishDraft,
): string | null {
  if (draft.bytes.byteLength === 0) {
    return "select a PDF file to publish";
  }
  if (draft.bytes.byteLength > default_pdf_limits.max_bytes) {
    return `PDF exceeds ${default_pdf_limits.max_bytes} bytes`;
  }
  const filename_error = pdf_filename_violation(draft.filename);
  if (filename_error !== null) {
    return filename_error;
  }
  const endpoints = [draft.canonical, ...draft.alternates];
  if (endpoints.length > max_page_endpoints) {
    return `configure at most ${max_page_endpoints} endpoints`;
  }
  for (const endpoint of endpoints) {
    if (endpoint.namespace.trim() === "") {
      return "each endpoint needs a namespace";
    }
    if (!is_valid_delivery_profile(endpoint.delivery_profile)) {
      return "each endpoint needs a supported delivery profile";
    }
  }
  if (draft.canonical.delivery_profile !== "inline") {
    return "the canonical endpoint must deliver the PDF inline";
  }
  if (!draft.alternates.some((row) => row.delivery_profile === "attachment")) {
    return "add an attachment endpoint so the PDF can be downloaded";
  }
  return null;
}

function endpoint_binding(row: PdfEndpointDraft): PageEndpointBinding {
  const namespace = row.namespace.trim();
  const page_name = row.page_name.trim();
  const locator: Locator = page_name === ""
    ? { namespace }
    : { namespace, page_name };
  return { locator, delivery_profile: row.delivery_profile };
}

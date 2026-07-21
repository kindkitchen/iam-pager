export type PageApiFailureKind =
  | "authority"
  | "endpoint"
  | "pdf"
  | "size"
  | "stale"
  | "availability"
  | "request";

export interface PageApiFailure {
  readonly kind: PageApiFailureKind;
  readonly code: string | null;
  readonly message: string;
}

export interface PageApiFailureContext {
  readonly operation: "publish" | "manage";
  readonly content_type?: string;
}

/** Maps page API failures onto bounded creator-facing categories and copy. */
export interface PageApiFailurePresenter {
  present(
    status: number,
    body: unknown,
    context: PageApiFailureContext,
  ): PageApiFailure;
}

interface PageApiErrorBody {
  readonly error: string;
  readonly detail: string;
}

/**
 * Keeps server error codes out of components and does not pass unknown response
 * detail into the DOM. Known PDF constraints map to fixed copy; all other
 * detail is discarded so future handlers cannot leak internals through the UI.
 */
export class TypedPageApiFailurePresenter implements PageApiFailurePresenter {
  present(
    status: number,
    body: unknown,
    context: PageApiFailureContext,
  ): PageApiFailure {
    const error = page_api_error_body(body);
    const code = error?.error ?? null;
    const is_pdf = context.content_type === "pdf";

    switch (code) {
      case "not_authenticated":
        return failure(
          "authority",
          code,
          "Sign in again before continuing.",
        );
      case "invalid_csrf":
        return failure(
          "authority",
          code,
          "This action could not be authorized. Refresh the page and try again.",
        );
      case "namespace_not_reserved":
        return failure(
          "authority",
          code,
          "Reserve this namespace before publishing as a creator.",
        );
      case "namespace_reserved":
        return failure(
          "authority",
          code,
          "This namespace is reserved by another creator.",
        );
      case "forbidden_namespace":
        return failure(
          "authority",
          code,
          "This namespace is reserved by the platform.",
        );
      case "private_requires_managed_page":
        return failure(
          "authority",
          code,
          "Private access requires a creator-managed page.",
        );
      case "not_found":
        return failure(
          "authority",
          code,
          "This page is missing or no longer available to this account.",
        );
      case "invalid_locator":
        return failure(
          "endpoint",
          code,
          "One endpoint cannot be mapped to a page path.",
        );
      case "duplicate_locator":
        return failure(
          "endpoint",
          code,
          "Every reference must use a unique path.",
        );
      case "unsupported_delivery_profile":
        return failure(
          "endpoint",
          code,
          "One endpoint uses a delivery option this content does not support.",
        );
      case "endpoint_capacity_exceeded":
        return failure(
          "endpoint",
          code,
          "The selected storage cannot atomically save this many references.",
        );
      case "page_exists":
      case "endpoint_conflict":
        return failure(
          "endpoint",
          code,
          "One of these endpoints is already used by a managed page.",
        );
      case "precondition_failed":
      case "precondition_required":
      case "invalid_if_match":
        return failure(
          "stale",
          code,
          "This page changed elsewhere. Review the refreshed page before trying again.",
        );
      case "revision_exhausted":
        return failure(
          "stale",
          code,
          "This page cannot accept another revision.",
        );
      case "request_too_large":
        return failure(
          "size",
          code,
          is_pdf
            ? "The PDF upload is larger than the accepted limit."
            : "The request is larger than the accepted limit.",
        );
      case "unsupported_media_type":
        return failure(
          is_pdf ? "pdf" : "request",
          code,
          is_pdf
            ? "The upload must be a PDF sent from the PDF file control."
            : "The request uses an unsupported content type.",
        );
      case "invalid_input":
        if (is_pdf) {
          return pdf_input_failure(code, error?.detail ?? "");
        }
        return failure("request", code, "The page content is invalid.");
      case "invalid_request":
      case "invalid_json":
        return failure(
          is_pdf ? "pdf" : "request",
          code,
          is_pdf
            ? "The PDF upload could not be read. Keep the selection, review its endpoints, and try again."
            : "The page request could not be read.",
        );
      case "invalid_access":
        return failure("request", code, "The selected page access is invalid.");
      case "invalid_tags":
        return failure("request", code, "Review the page tags and try again.");
      case "unknown_content_type":
        return failure(
          "request",
          code,
          "This page content type is not supported.",
        );
      case "page_unavailable":
      case "page_id_generation_exhausted":
      case "page_name_generation_exhausted":
        return failure(
          "availability",
          code,
          "Page management is temporarily unavailable. Try again later.",
        );
      default:
        return failure(
          status >= 500 ? "availability" : "request",
          code,
          `${
            context.operation === "publish" ? "Publishing" : "Page management"
          } failed (${status}).`,
        );
    }
  }
}

export const page_api_failure_presenter: PageApiFailurePresenter =
  new TypedPageApiFailurePresenter();

function page_api_error_body(value: unknown): PageApiErrorBody | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.ok !== false || typeof record.error !== "string" ||
    record.error === "" || typeof record.detail !== "string" ||
    record.detail === ""
  ) {
    return null;
  }
  return { error: record.error, detail: record.detail };
}

function failure(
  kind: PageApiFailureKind,
  code: string | null,
  message: string,
): PageApiFailure {
  return { kind, code, message };
}

function pdf_input_failure(code: string, detail: string): PageApiFailure {
  if (detail.startsWith("pdf exceeds ")) {
    return failure("size", code, "The PDF is larger than the accepted limit.");
  }
  if (detail.startsWith("filename ")) {
    return failure("pdf", code, "The PDF filename was not accepted.");
  }
  if (detail.includes("supported PDF header")) {
    return failure(
      "pdf",
      code,
      "The file does not begin with a supported PDF header.",
    );
  }
  if (detail.includes("startxref/%%EOF")) {
    return failure(
      "pdf",
      code,
      "The file does not have the required PDF ending structure.",
    );
  }
  return failure("pdf", code, "The selected file was not accepted as a PDF.");
}

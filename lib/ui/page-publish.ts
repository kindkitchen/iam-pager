import { is_safe_page_path } from "../page/endpoint.ts";
import type { NamespacePanel } from "./namespace-panel.ts";

/** Safe page-publishing authority presented to the island; no session IDs. */
export type PagePublishAuthorization =
  | { readonly kind: "guest" }
  | { readonly kind: "creator"; readonly csrf_token: string };

export interface PagePublishDraft {
  readonly namespace: string;
  readonly page_name: string;
  readonly markdown: string;
  readonly css: string;
}

export interface PagePublishSuccess {
  readonly path: string;
}

export interface PreparedPagePublishRequest {
  readonly headers: Headers;
  readonly body: {
    readonly locator: {
      readonly namespace: string;
      readonly page_name?: string;
    };
    readonly access: "public";
    readonly content: {
      readonly content_type: "md-page";
      readonly input: { readonly md: string; readonly css?: string };
    };
  };
}

/** Reuses the already-authorized namespace presenter without exposing session. */
export function page_publish_authorization(
  namespace_panel: NamespacePanel,
): PagePublishAuthorization {
  return namespace_panel.kind === "creator"
    ? { kind: "creator", csrf_token: namespace_panel.csrf_token }
    : { kind: "guest" };
}

/** Validates only the bounded local link the publishing result renders. */
export function page_publish_success_from_api(
  value: unknown,
): PagePublishSuccess | null {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    return null;
  }
  const record = value as Record<string, unknown>;
  if (
    record.ok !== true || typeof record.path !== "string" ||
    !is_safe_page_path(record.path)
  ) {
    return null;
  }
  return { path: record.path };
}

/** Maps editable state to the explicit page API contract without mutating it. */
export function prepare_page_publish_request(
  draft: PagePublishDraft,
  authorization: PagePublishAuthorization,
): PreparedPagePublishRequest {
  const namespace = draft.namespace.trim();
  const page_name = draft.page_name.trim();
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization.kind === "creator") {
    headers.set("x-csrf-token", authorization.csrf_token);
  }
  return {
    headers,
    body: {
      locator: {
        namespace,
        ...(page_name === "" ? {} : { page_name }),
      },
      access: "public",
      content: {
        content_type: "md-page",
        input: {
          md: draft.markdown,
          ...(draft.css === "" ? {} : { css: draft.css }),
        },
      },
    },
  };
}

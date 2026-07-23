import type { DeliveryProfile } from "../content/model.ts";
import { is_safe_page_path } from "../page/endpoint.ts";
import type { NamespacePanel } from "./namespace-panel.ts";

/** Safe page-publishing authority presented to the island; no session IDs. */
export type PagePublishAuthorization =
  | { readonly kind: "guest" }
  | {
    readonly kind: "creator";
    readonly csrf_token: string;
    readonly owned_namespaces: readonly string[];
  };

/** One user-entered locator reference before trimming and API projection. */
export interface PagePublishReferenceDraft {
  readonly namespace: string;
  readonly page_name: string;
  readonly delivery_profile: DeliveryProfile;
}

export interface PagePublishDraft {
  readonly primary: PagePublishReferenceDraft;
  readonly aliases: readonly PagePublishReferenceDraft[];
  readonly markdown: string;
  readonly css: string;
  readonly storage_provider_id?: string;
}

export interface PagePublishSuccess {
  readonly path: string;
}

export interface PreparedPagePublishRequest {
  readonly headers: Headers;
  readonly body: {
    readonly endpoint_set: {
      readonly canonical: {
        readonly locator: {
          readonly namespace: string;
          readonly page_name?: string;
        };
        readonly delivery_profile: "inline";
      };
      readonly alternates: readonly {
        readonly locator: {
          readonly namespace: string;
          readonly page_name?: string;
        };
        readonly delivery_profile: "inline";
      }[];
    };
    readonly access: "public";
    readonly content: {
      readonly content_type: "md-page";
      readonly input: { readonly md: string; readonly css?: string };
      readonly storage?: { readonly provider_id: string };
    };
  };
}

/** Reuses the authorized namespace presenter without exposing session identity. */
export function page_publish_authorization(
  namespace_panel: NamespacePanel,
): PagePublishAuthorization {
  return namespace_panel.kind === "creator"
    ? {
      kind: "creator",
      csrf_token: namespace_panel.csrf_token,
      owned_namespaces: namespace_panel.reservations.map((reservation) =>
        reservation.namespace
      ),
    }
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

/** Maps editable state to the explicit multi-reference page API contract. */
export function prepare_page_publish_request(
  draft: PagePublishDraft,
  authorization: PagePublishAuthorization,
): PreparedPagePublishRequest {
  const headers = new Headers({ "content-type": "application/json" });
  if (authorization.kind === "creator") {
    headers.set("x-csrf-token", authorization.csrf_token);
  }
  return {
    headers,
    body: {
      endpoint_set: {
        canonical: markdown_binding(draft.primary),
        alternates: draft.aliases.map(markdown_binding),
      },
      access: "public",
      content: {
        content_type: "md-page",
        input: {
          md: draft.markdown,
          ...(draft.css === "" ? {} : { css: draft.css }),
        },
        ...(draft.storage_provider_id === undefined ? {} : {
          storage: { provider_id: draft.storage_provider_id },
        }),
      },
    },
  };
}

function markdown_binding(reference: PagePublishReferenceDraft) {
  const namespace = reference.namespace.trim();
  const page_name = reference.page_name.trim();
  return {
    locator: {
      namespace,
      ...(page_name === "" ? {} : { page_name }),
    },
    delivery_profile: "inline" as const,
  };
}

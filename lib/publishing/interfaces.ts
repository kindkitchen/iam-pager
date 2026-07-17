import type { Locator } from "../locator/model.ts";
import type { DeliveryPayload, PageRecord } from "../content/model.ts";

/**
 * Request to place content at a locator (CP-PUBLISH). Placement is
 * create-or-replace: the guest flow always places content at a location and
 * has no separate update (001.draft).
 */
export interface PublishRequest {
  locator: Locator;
  /** Names the ContentTypeHandler that owns `input`. */
  content_type: string;
  /** Untrusted input; the handler's `validate` narrows it. */
  input: unknown;
}

export type PublishResult =
  | { ok: true; page: PageRecord; path: string }
  | { ok: false; reason: "forbidden_namespace" }
  | { ok: false; reason: "invalid_locator" }
  | { ok: false; reason: "unknown_content_type" }
  | { ok: false; reason: "invalid_input"; detail: string };

export type DeliverResult =
  | { ok: true; page: PageRecord; payload: DeliveryPayload }
  | { ok: false; reason: "not_found" | "unknown_content_type" };

/**
 * Publish side of the content flow. Implementations must be the only
 * producer of stored records and must always run `validate -> derive`
 * (006.review item 1), so nothing sanitized-by-derivation can be bypassed.
 */
export interface PagePublisher {
  publish(request: PublishRequest): Promise<PublishResult>;
}

/** Delivery side: locator in, raw payload out (CP-DELIVERY). */
export interface PageDeliverer {
  deliver(locator: Locator): Promise<DeliverResult>;
}

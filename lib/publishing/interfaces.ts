import type { Locator } from "../locator/model.ts";
import type { DeliveryPayload, PageRecord } from "../content/model.ts";

/**
 * Who is asking to publish (DA-NAMESPACE). Deliberately not an HTTP or
 * session concept: the web layer derives it from its session, other surfaces
 * derive it from theirs.
 */
export type PublishActor =
  | { kind: "guest" }
  | { kind: "user"; user_id: string };

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
  /** Absent means guest: an unstated actor never gains ownership rights. */
  actor?: PublishActor;
}

export type PublishResult =
  | { ok: true; page: PageRecord; path: string }
  | { ok: false; reason: "forbidden_namespace" }
  | { ok: false; reason: "invalid_locator" }
  /** The namespace is reserved by a creator other than the actor. */
  | { ok: false; reason: "namespace_reserved" }
  | { ok: false; reason: "unknown_content_type" }
  | { ok: false; reason: "invalid_input"; detail: string };

export type PublishAuthorization =
  | { allowed: true }
  | { allowed: false; reason: "namespace_reserved" };

/**
 * Decides whether an actor may write into a namespace (DA-NAMESPACE):
 * unreserved namespaces allow every actor, reserved namespaces allow only
 * their owner. Applied where publishing decides whether a write proceeds;
 * `ContentRepository` itself stays protection-free by contract.
 */
export interface PublishingAuthorizer {
  authorize(
    actor: PublishActor,
    namespace: string,
  ): Promise<PublishAuthorization>;
}

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

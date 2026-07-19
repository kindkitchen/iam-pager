import type { LocatorEngine } from "../locator/engine.ts";
import type { Locator } from "../locator/model.ts";
import type {
  ContentRepository,
  ContentTypeHandler,
} from "../content/interfaces.ts";
import type {
  ContentMeta,
  DeliveryPayload,
  PageRecord,
} from "../content/model.ts";
import type {
  DeliverResult,
  PageDeliverer,
  PagePublisher,
  PublishingAuthorizer,
  PublishRequest,
  PublishResult,
} from "./interfaces.ts";

export interface PublishingServiceOptions {
  engine: LocatorEngine;
  repository: ContentRepository;
  handlers: readonly ContentTypeHandler<unknown, unknown>[];
  /**
   * Write authorization (DA-NAMESPACE). Absent means every namespace
   * behaves as unreserved — acceptable only where no reservations exist;
   * the composition root always wires one.
   */
  authorizer?: PublishingAuthorizer;
  /** Clock, injectable for tests. Defaults to `() => new Date()`. */
  now?: () => Date;
}

/**
 * The publish/deliver use-cases on top of the locator and content layers.
 *
 * Owns the publish invariant: every stored record passes
 * `validate -> derive -> render`, so publish is the only producer of stored
 * data and derived representations are always sanitized (006.review item 1).
 *
 * Meta reconciliation (006.review item 2): `render` is deterministic for
 * stored data, so `ContentMeta` is computed from its output once at publish
 * time and cannot go stale next to the delivered payload (QT-ROUTING).
 *
 * Namespace protection (DA-NAMESPACE): before content handling, the actor
 * (absent = guest) is checked by the authorizer, so a reserved namespace
 * rejects every non-owner write while unreserved namespaces keep guest
 * placement behavior.
 */
export class PublishingService implements PagePublisher, PageDeliverer {
  #engine: LocatorEngine;
  #repository: ContentRepository;
  #handlers = new Map<string, ContentTypeHandler<unknown, unknown>>();
  #authorizer: PublishingAuthorizer | null;
  #now: () => Date;

  constructor(options: PublishingServiceOptions) {
    for (const handler of options.handlers) {
      if (this.#handlers.has(handler.content_type)) {
        throw new Error(`duplicate content type: ${handler.content_type}`);
      }
      this.#handlers.set(handler.content_type, handler);
    }
    this.#engine = options.engine;
    this.#repository = options.repository;
    this.#authorizer = options.authorizer ?? null;
    this.#now = options.now ?? (() => new Date());
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    const locator_validation = this.#engine.validate(request.locator);
    if (!locator_validation.ok) {
      return {
        ok: false,
        reason: locator_validation.reason === "forbidden_namespace"
          ? "forbidden_namespace"
          : "invalid_locator",
      };
    }
    if (this.#authorizer !== null) {
      const authorization = await this.#authorizer.authorize(
        request.actor ?? { kind: "guest" },
        request.locator.namespace,
      );
      if (!authorization.allowed) {
        return { ok: false, reason: authorization.reason };
      }
    }
    const handler = this.#handlers.get(request.content_type);
    if (!handler) return { ok: false, reason: "unknown_content_type" };
    const validated = handler.validate(request.input);
    if (!validated.ok) {
      return { ok: false, reason: "invalid_input", detail: validated.reason };
    }
    const data = handler.derive(validated.value);
    const meta = meta_from_payload(handler.render(data));
    const existing = await this.#repository.get(request.locator);
    const now = this.#now();
    const page: PageRecord = {
      locator: request.locator,
      content: {
        content_type: handler.content_type,
        data,
        meta,
        created_at: existing?.content.created_at ?? now,
        updated_at: now,
      },
    };
    await this.#repository.put(page);
    return { ok: true, page, path: this.#engine.format(request.locator) };
  }

  async deliver(locator: Locator): Promise<DeliverResult> {
    const page = await this.#repository.get(locator);
    if (page === null) return { ok: false, reason: "not_found" };
    const handler = this.#handlers.get(page.content.content_type);
    if (!handler) return { ok: false, reason: "unknown_content_type" };
    return { ok: true, page, payload: handler.render(page.content.data) };
  }
}

/** Delivery metadata derived from the deterministic render output. */
function meta_from_payload(payload: DeliveryPayload): ContentMeta {
  const size_bytes = typeof payload.body === "string"
    ? new TextEncoder().encode(payload.body).byteLength
    : payload.body.byteLength;
  return payload.download_filename === undefined
    ? { media_type: payload.media_type, size_bytes }
    : {
      media_type: payload.media_type,
      size_bytes,
      download_filename: payload.download_filename,
    };
}

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
  PublishRequest,
  PublishResult,
} from "./interfaces.ts";

export interface PublishingServiceOptions {
  engine: LocatorEngine;
  repository: ContentRepository;
  handlers: readonly ContentTypeHandler<unknown, unknown>[];
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
 */
export class PublishingService implements PagePublisher, PageDeliverer {
  #engine: LocatorEngine;
  #repository: ContentRepository;
  #handlers = new Map<string, ContentTypeHandler<unknown, unknown>>();
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
    this.#now = options.now ?? (() => new Date());
  }

  async publish(request: PublishRequest): Promise<PublishResult> {
    if (this.#engine.is_forbidden(request.locator.namespace)) {
      return { ok: false, reason: "forbidden_namespace" };
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

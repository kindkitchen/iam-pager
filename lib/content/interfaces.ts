import type { ContentRecord, DeliveryPayload } from "./model.ts";

export type ContentResult<T> =
  | { ok: true; value: T }
  | { ok: false; reason: string };

/**
 * Interface-first content CRUD: a content type becomes usable by satisfying
 * this interface, without further wiring.
 *
 * `validate` and `derive` run at publish time so derived representations
 * (e.g. html from md) are stored once, not rebuilt per request. `render`
 * runs at delivery time.
 */
export interface ContentTypeHandler<Input, Data> {
  readonly content_type: string;
  /** Check untrusted input and narrow it to the type's input shape. */
  validate(input: unknown): ContentResult<Input>;
  /** Derive the stored data from valid input (e.g. md -> md + html). */
  derive(input: Input): Data;
  /** Produce the raw delivery payload for stored data. */
  render(data: Data): DeliveryPayload;
}

/**
 * Storage for content records keyed by the case-insensitive locator key.
 *
 * `put` is create-or-replace: the guest flow always places content at a
 * location and has no separate update. Namespace protection rules
 * (DA-LIFECYCLE) are enforced above this interface, not inside it.
 */
export interface ContentRepository {
  get(locator_key: string): Promise<ContentRecord | null>;
  put(locator_key: string, record: ContentRecord): Promise<void>;
  delete(locator_key: string): Promise<boolean>;
}

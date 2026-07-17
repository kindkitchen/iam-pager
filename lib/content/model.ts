import type { Locator } from "../locator/model.ts";

/** Delivery metadata for stored content (DA-CONTENT). */
export interface ContentMeta {
  media_type: string;
  size_bytes: number;
  download_filename?: string;
}

/** One stored piece of content bound to a locator. */
export interface ContentRecord<Data = unknown> {
  /** Discriminates which ContentTypeHandler owns `data`. */
  content_type: string;
  /** Type-specific stored data, including publish-time derivations. */
  data: Data;
  meta: ContentMeta;
  created_at: Date;
  updated_at: Date;
}

/**
 * A stored page: the publisher-cased locator next to its current content.
 * Identity is the case-insensitive `locator_key`; the `locator` field keeps
 * the original spelling for display (DA-LOCATOR).
 */
export interface PageRecord<Data = unknown> {
  locator: Locator;
  content: ContentRecord<Data>;
}

/** Raw payload handed to HTTP delivery, independent of routing. */
export interface DeliveryPayload {
  body: string | Uint8Array;
  media_type: string;
  download_filename?: string;
}

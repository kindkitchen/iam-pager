/** Delivery metadata for stored content (DA-CONTENT). */
export interface ContentMeta {
  media_type: string;
  size_bytes: number;
  download_filename?: string;
}

/** Raw payload handed to HTTP delivery, independent of routing. */
export interface DeliveryPayload {
  body: string | Uint8Array;
  media_type: string;
  download_filename?: string;
}

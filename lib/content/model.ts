/** Endpoint-selected delivery behavior; path shape never implies a profile. */
export type DeliveryProfile = "inline" | "attachment";

export function is_valid_delivery_profile(
  value: unknown,
): value is DeliveryProfile {
  return value === "inline" || value === "attachment";
}

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

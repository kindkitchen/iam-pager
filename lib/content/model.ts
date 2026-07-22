/**
 * Endpoint-selected delivery behavior. Profiles are stable lowercase tokens so
 * content handlers and future transports can add capabilities without changing
 * the content or locator models. The current HTTP adapter implements `inline`
 * and `attachment`.
 */
export type DeliveryProfile = string;

export const max_delivery_profile_length = 32;
const delivery_profile_pattern = /^[a-z][a-z0-9-]*$/;

/** True for one bounded, transport-neutral delivery-profile identifier. */
export function is_valid_delivery_profile(
  value: unknown,
): value is DeliveryProfile {
  return typeof value === "string" &&
    value.length <= max_delivery_profile_length &&
    delivery_profile_pattern.test(value);
}

/** Authoritative local facts for one immutable content representation. */
export interface ContentMeta {
  media_type: string;
  size_bytes: number;
  download_filename?: string;
  /** SHA-256 of canonical externally stored bytes; required for external assets. */
  sha256?: string;
  /** Bounded content codec/schema identifier; required for external assets. */
  codec_version?: string;
}

/** Raw payload handed to HTTP delivery, independent of routing. */
export interface DeliveryPayload {
  body: string | Uint8Array;
  media_type: string;
  download_filename?: string;
}

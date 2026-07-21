/** Encode bytes as canonical unpadded base64url. */
export function encode_base64url(bytes: Uint8Array): string {
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(
    /=+$/,
    "",
  );
}

/** Decode only canonical unpadded base64url. */
export function decode_base64url(value: string): Uint8Array | null {
  try {
    const padded = value.padEnd(value.length + (4 - value.length % 4) % 4, "=");
    const binary = atob(padded.replaceAll("-", "+").replaceAll("_", "/"));
    const bytes = Uint8Array.from(
      binary,
      (character) => character.charCodeAt(0),
    );
    return encode_base64url(bytes) === value ? bytes : null;
  } catch {
    return null;
  }
}

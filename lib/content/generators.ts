import type { ContentAssetIdGenerator } from "./interfaces.ts";

/** 128-bit random asset id encoded as unpadded base64url. */
export class CryptoContentAssetIdGenerator implements ContentAssetIdGenerator {
  generate(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(16));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }
}

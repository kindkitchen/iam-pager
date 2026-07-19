import type { PageClock, PageIdGenerator } from "./interfaces.ts";

/** 128-bit random id encoded as unpadded base64url: 22 route-safe chars. */
export class CryptoPageIdGenerator implements PageIdGenerator {
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

export class SystemPageClock implements PageClock {
  now(): Date {
    return new Date();
  }
}

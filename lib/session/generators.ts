import type { Clock, CredentialGenerator, IdGenerator } from "./interfaces.ts";

export class SystemClock implements Clock {
  now(): Date {
    return new Date();
  }
}

export class CryptoIdGenerator implements IdGenerator {
  generate(): string {
    return crypto.randomUUID();
  }
}

/** Generates a 256-bit bearer credential encoded without cookie delimiters. */
export class CryptoCredentialGenerator implements CredentialGenerator {
  generate(): string {
    const bytes = crypto.getRandomValues(new Uint8Array(32));
    let binary = "";
    for (const byte of bytes) binary += String.fromCharCode(byte);
    return btoa(binary)
      .replaceAll("+", "-")
      .replaceAll("/", "_")
      .replace(/=+$/, "");
  }
}

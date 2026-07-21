import { encode_base64url } from "../base64url.ts";
import type { Clock, IdGenerator, SecretGenerator } from "./interfaces.ts";

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

/** 256 random bits encoded as unpadded base64url (43 characters). */
export class CryptoSecretGenerator implements SecretGenerator {
  generate(): string {
    return encode_base64url(crypto.getRandomValues(new Uint8Array(32)));
  }
}

/** One-way SHA-256 lookup hash; the only bearer derivative that persists. */
export async function hash_api_key_bearer(bearer: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(bearer),
  );
  return Array.from(
    new Uint8Array(digest),
    (byte) => byte.toString(16).padStart(2, "0"),
  ).join("");
}

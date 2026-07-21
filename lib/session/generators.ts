import { encode_base64url } from "../base64url.ts";
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
    return encode_base64url(crypto.getRandomValues(new Uint8Array(32)));
  }
}

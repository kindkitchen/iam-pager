import { encode_base64url } from "../base64url.ts";
import type { PageClock, PageIdGenerator } from "./interfaces.ts";

/** 128-bit random id encoded as unpadded base64url: 22 route-safe chars. */
export class CryptoPageIdGenerator implements PageIdGenerator {
  generate(): string {
    return encode_base64url(crypto.getRandomValues(new Uint8Array(16)));
  }
}

export class SystemPageClock implements PageClock {
  now(): Date {
    return new Date();
  }
}

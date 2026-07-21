import { encode_base64url } from "../base64url.ts";
import type { ContentAssetIdGenerator } from "./interfaces.ts";

/** 128-bit random asset id encoded as unpadded base64url. */
export class CryptoContentAssetIdGenerator implements ContentAssetIdGenerator {
  generate(): string {
    return encode_base64url(crypto.getRandomValues(new Uint8Array(16)));
  }
}

import { deserialize, serialize } from "node:v8";

export interface ContentDataCodec {
  readonly encoding: string;
  encode(value: unknown): Uint8Array;
  decode(bytes: Uint8Array): unknown;
}

/** V8 structured-clone codec for inline asset data only. External assets bypass it. */
export class V8ContentDataCodec implements ContentDataCodec {
  readonly encoding = "v8";

  encode(value: unknown): Uint8Array {
    try {
      const encoded = serialize(value);
      return Uint8Array.from(encoded);
    } catch {
      throw new TypeError("content data must be V8-serializable");
    }
  }

  decode(bytes: Uint8Array): unknown {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError("invalid V8-encoded content data");
    }
    try {
      return deserialize(bytes.slice());
    } catch {
      throw new TypeError("invalid V8-encoded content data");
    }
  }
}

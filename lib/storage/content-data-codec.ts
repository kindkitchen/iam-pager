import { deserialize, serialize } from "node:v8";

/** Manifest value for the retained V8 structured-clone payload format. */
export const content_data_encoding_v8_1 = "v8-1" as const;

export interface ContentDataCodec {
  readonly encoding_version: string;
  encode(value: unknown): Uint8Array;
  decode(bytes: Uint8Array): unknown;
}

/** Versioned codec compatible with the superseded prototype's V8 payloads. */
export class V8ContentDataCodec implements ContentDataCodec {
  readonly encoding_version = content_data_encoding_v8_1;

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

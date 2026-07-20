import { KvToolbox } from "@kitsonk/kv-toolbox";
import { BLOB_META_KEY } from "@kitsonk/kv-toolbox/blob";
import type { KvBinaryObjectMetadata, KvGateway } from "./kv-gateway.ts";

function clone_key(key: Deno.KvKey): Deno.KvKey {
  return key.map((part) => part instanceof Uint8Array ? part.slice() : part);
}

function decode_binary_metadata(
  value: unknown,
  versionstamp: string,
): KvBinaryObjectMetadata {
  if (
    typeof value !== "object" || value === null || Array.isArray(value)
  ) {
    throw new TypeError("invalid stored binary object metadata");
  }
  const metadata = value as Record<string, unknown>;
  const keys = Object.keys(metadata).sort();
  if (
    keys.length !== 2 || keys[0] !== "kind" || keys[1] !== "size" ||
    metadata.kind !== "buffer" ||
    !Number.isSafeInteger(metadata.size) || (metadata.size as number) < 1
  ) {
    throw new TypeError("invalid stored binary object metadata");
  }
  return {
    byte_length: metadata.size as number,
    versionstamp,
  };
}

/**
 * kv-toolbox-backed gateway. Constructing it transfers lifecycle ownership of
 * the supplied Deno KV handle; `close` closes that same handle.
 */
export class KvToolboxGateway implements KvGateway {
  readonly #toolbox: KvToolbox;

  constructor(kv: Deno.Kv) {
    this.#toolbox = new KvToolbox(kv);
  }

  get<T = unknown>(
    key: Deno.KvKey,
    options?: { consistency?: Deno.KvConsistencyLevel },
  ): Promise<Deno.KvEntryMaybe<T>> {
    return this.#toolbox.get<T>(key, options);
  }

  get_many<T extends readonly unknown[]>(
    keys: readonly [...{ [K in keyof T]: Deno.KvKey }],
    options?: { consistency?: Deno.KvConsistencyLevel },
  ): Promise<{ [K in keyof T]: Deno.KvEntryMaybe<T[K]> }> {
    return this.#toolbox.getMany<T>(keys, options);
  }

  list<T = unknown>(
    selector: Deno.KvListSelector,
    options?: Deno.KvListOptions,
  ): Deno.KvListIterator<T> {
    return this.#toolbox.list<T>(selector, options);
  }

  set(
    key: Deno.KvKey,
    value: unknown,
    options?: { expireIn?: number },
  ): Promise<Deno.KvCommitResult> {
    return this.#toolbox.set(key, value, options);
  }

  delete(key: Deno.KvKey): Promise<void> {
    return this.#toolbox.delete(key);
  }

  native_atomic(): Deno.AtomicOperation {
    return this.#toolbox.db.atomic();
  }

  async stage_binary_object(
    key: Deno.KvKey,
    bytes: Uint8Array,
  ): Promise<void> {
    if (!(bytes instanceof Uint8Array) || bytes.byteLength === 0) {
      throw new TypeError("binary object bytes must be a non-empty Uint8Array");
    }
    const stored_key = clone_key(key);
    const stored_bytes = bytes.slice();
    if (await this.get_binary_object_metadata(stored_key) !== null) {
      throw new TypeError("binary object staging key must be unused");
    }

    try {
      const result = await this.#toolbox.setBlob(stored_key, stored_bytes);
      if (!result.ok) throw new Error("failed to stage binary object");
      const verified = await this.read_binary_object(stored_key);
      if (
        verified === null || verified.byteLength !== stored_bytes.byteLength ||
        verified.some((byte, index) => byte !== stored_bytes[index])
      ) {
        throw new Error("failed to verify staged binary object");
      }
    } catch (error) {
      try {
        await this.remove_binary_object(stored_key);
      } catch {
        // The key is unreachable; a later bounded reconciler may remove it.
      }
      throw error;
    }
  }

  async read_binary_object(key: Deno.KvKey): Promise<Uint8Array | null> {
    const stored_key = clone_key(key);
    const metadata_entry = await this.#toolbox.getMeta(stored_key);
    if (metadata_entry.versionstamp === null) return null;
    const metadata = decode_binary_metadata(
      metadata_entry.value,
      metadata_entry.versionstamp,
    );
    const binary_entry = await this.#toolbox.getBlob(stored_key);
    if (
      binary_entry.versionstamp !== metadata.versionstamp ||
      !(binary_entry.value instanceof Uint8Array) ||
      binary_entry.value.byteLength !== metadata.byte_length
    ) {
      throw new TypeError("invalid stored binary object");
    }
    return binary_entry.value.slice();
  }

  async get_binary_object_metadata(
    key: Deno.KvKey,
  ): Promise<KvBinaryObjectMetadata | null> {
    const entry = await this.#toolbox.getMeta(clone_key(key));
    return entry.versionstamp === null
      ? null
      : decode_binary_metadata(entry.value, entry.versionstamp);
  }

  async remove_binary_object(key: Deno.KvKey): Promise<void> {
    const stored_key = clone_key(key);
    try {
      await this.#toolbox.delete(stored_key, { blob: true });
    } finally {
      // kv-toolbox skips its metadata key when every chunk is already absent.
      await this.#toolbox.delete([...stored_key, BLOB_META_KEY]);
    }
  }

  close(): void {
    this.#toolbox.close();
  }
}

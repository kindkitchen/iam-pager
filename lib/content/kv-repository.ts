import { type Locator, locator_key } from "../locator/model.ts";
import type { ContentRepository } from "./interfaces.ts";
import type { ContentMeta, PageRecord } from "./model.ts";

const storage_schema_version = 1;
const max_attempts = 16;
// Key paths stay stable across value-schema upgrades so identity cannot fork.
const envelope_prefix: Deno.KvKey = [
  "iam-pager",
  "content-pages",
  "by-locator",
];
const chunk_prefix: Deno.KvKey = ["iam-pager", "content-pages", "chunks"];
/** Stays well under the 64 KiB Deno KV value limit to leave codec headroom. */
export const content_chunk_byte_length = 48 * 1024;
/** Keeps each chunk-write batch far below the KV atomic payload ceiling. */
const chunk_write_batch_size = 10;

/**
 * Envelope of one stored page: everything except `data`, which lives in the
 * generation's chunks. `data_encoding` names the chunk codec so future
 * envelopes can carry non-JSON payloads without a key migration.
 */
interface StoredPageEnvelope {
  readonly schema_version: 1;
  readonly namespace: string;
  readonly page_name?: string;
  readonly content_type: string;
  readonly media_type: string;
  readonly size_bytes: number;
  readonly download_filename?: string;
  readonly created_at: string;
  readonly updated_at: string;
  readonly data_encoding: "json";
  readonly generation: string;
  readonly chunk_count: number;
  readonly data_byte_length: number;
}

function envelope_key(key: string): Deno.KvKey {
  return [...envelope_prefix, key];
}

function generation_prefix(key: string, generation: string): Deno.KvKey {
  return [...chunk_prefix, key, generation];
}

function chunk_key(key: string, generation: string, index: number): Deno.KvKey {
  return [...generation_prefix(key, generation), index];
}

function invalid_envelope(): never {
  throw new TypeError("invalid stored content page");
}

function stored_date(value: unknown): Date {
  if (typeof value !== "string") return invalid_envelope();
  const date = new Date(value);
  if (Number.isNaN(date.getTime()) || date.toISOString() !== value) {
    return invalid_envelope();
  }
  return date;
}

function deserialize_envelope(value: unknown): StoredPageEnvelope {
  if (typeof value !== "object" || value === null) return invalid_envelope();
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    typeof stored.namespace !== "string" ||
    (stored.page_name !== undefined && typeof stored.page_name !== "string") ||
    typeof stored.content_type !== "string" ||
    typeof stored.media_type !== "string" ||
    typeof stored.size_bytes !== "number" ||
    (stored.download_filename !== undefined &&
      typeof stored.download_filename !== "string") ||
    stored.data_encoding !== "json" ||
    typeof stored.generation !== "string" ||
    !Number.isInteger(stored.chunk_count) ||
    (stored.chunk_count as number) < 1 ||
    !Number.isInteger(stored.data_byte_length) ||
    (stored.data_byte_length as number) < 0
  ) {
    return invalid_envelope();
  }
  stored_date(stored.created_at);
  stored_date(stored.updated_at);
  return stored as unknown as StoredPageEnvelope;
}

function envelope_locator(envelope: StoredPageEnvelope): Locator {
  return envelope.page_name === undefined
    ? { namespace: envelope.namespace }
    : { namespace: envelope.namespace, page_name: envelope.page_name };
}

function envelope_page(
  envelope: StoredPageEnvelope,
  data: unknown,
): PageRecord {
  const meta: ContentMeta = {
    media_type: envelope.media_type,
    size_bytes: envelope.size_bytes,
    ...(envelope.download_filename === undefined
      ? {}
      : { download_filename: envelope.download_filename }),
  };
  return {
    locator: envelope_locator(envelope),
    content: {
      content_type: envelope.content_type,
      data,
      meta,
      created_at: stored_date(envelope.created_at),
      updated_at: stored_date(envelope.updated_at),
    },
  };
}

function serialize_data(page: PageRecord): Uint8Array {
  const json: string | undefined = JSON.stringify(page.content.data);
  if (json === undefined) {
    throw new TypeError(
      "content data must be JSON-serializable for durable storage",
    );
  }
  return new TextEncoder().encode(json);
}

function split_chunks(bytes: Uint8Array): Uint8Array[] {
  const chunks: Uint8Array[] = [];
  for (
    let offset = 0;
    offset === 0 || offset < bytes.length;
    offset += content_chunk_byte_length
  ) {
    chunks.push(bytes.slice(offset, offset + content_chunk_byte_length));
  }
  return chunks;
}

/**
 * Deno KV-backed page storage using an envelope record plus immutable
 * generation chunks, because one page's source and derived data can exceed a
 * single KV value.
 *
 * Every `put` writes a fresh generation's chunks first and only then flips the
 * envelope to it with a versionstamp check, deleting the replaced generation
 * in the same atomic commit. A generation's chunks never change after the
 * envelope references them, so readers that see an envelope either read its
 * complete data or detect the concurrent flip and retry against the fresh
 * envelope. A crash between chunk writes and the flip can only orphan chunks
 * of a never-referenced generation, never corrupt the visible page.
 *
 * `data` must be JSON-serializable; the envelope records the codec as
 * `data_encoding` so later schema versions can add binary encodings.
 */
export class DenoKvContentRepository implements ContentRepository {
  readonly #kv: Deno.Kv;

  constructor(kv: Deno.Kv) {
    this.#kv = kv;
  }

  async get(locator: Locator): Promise<PageRecord | null> {
    const key = locator_key(locator);
    let entry = await this.#kv.get<unknown>(envelope_key(key));
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      if (entry.versionstamp === null) return null;
      const envelope = deserialize_envelope(entry.value);
      if (locator_key(envelope_locator(envelope)) !== key) {
        throw new Error("content repository invariant violated");
      }
      const bytes = await this.#read_generation(key, envelope);
      if (bytes !== null) {
        return envelope_page(
          envelope,
          JSON.parse(new TextDecoder().decode(bytes)),
        );
      }
      // Incomplete generation: either a concurrent flip removed it or the
      // stored page is corrupt. The envelope versionstamp tells them apart.
      const current = await this.#kv.get<unknown>(envelope_key(key));
      if (current.versionstamp === entry.versionstamp) invalid_envelope();
      entry = current;
    }
    throw new Error("content repository read contention exhausted retries");
  }

  async put(page: PageRecord): Promise<void> {
    const key = locator_key(page.locator);
    const bytes = serialize_data(page);
    const chunks = split_chunks(bytes);
    const generation = crypto.randomUUID();
    for (
      let start = 0;
      start < chunks.length;
      start += chunk_write_batch_size
    ) {
      const batch = this.#kv.atomic();
      chunks
        .slice(start, start + chunk_write_batch_size)
        .forEach((chunk, offset) =>
          batch.set(chunk_key(key, generation, start + offset), chunk)
        );
      const commit = await batch.commit();
      if (!commit.ok) {
        throw new Error("content repository chunk write failed");
      }
    }

    const envelope: StoredPageEnvelope = {
      schema_version: storage_schema_version,
      namespace: page.locator.namespace,
      ...(page.locator.page_name === undefined
        ? {}
        : { page_name: page.locator.page_name }),
      content_type: page.content.content_type,
      media_type: page.content.meta.media_type,
      size_bytes: page.content.meta.size_bytes,
      ...(page.content.meta.download_filename === undefined
        ? {}
        : { download_filename: page.content.meta.download_filename }),
      created_at: page.content.created_at.toISOString(),
      updated_at: page.content.updated_at.toISOString(),
      data_encoding: "json",
      generation,
      chunk_count: chunks.length,
      data_byte_length: bytes.length,
    };

    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const existing = await this.#kv.get<unknown>(envelope_key(key));
      const flip = this.#kv.atomic()
        .check(existing)
        .set(envelope_key(key), envelope);
      if (existing.versionstamp !== null) {
        this.#delete_generation(
          flip,
          key,
          deserialize_envelope(existing.value),
        );
      }
      const commit = await flip.commit();
      if (commit.ok) return;
    }
    throw new Error("content repository write contention exhausted retries");
  }

  async delete(locator: Locator): Promise<boolean> {
    const key = locator_key(locator);
    for (let attempt = 0; attempt < max_attempts; attempt += 1) {
      const existing = await this.#kv.get<unknown>(envelope_key(key));
      if (existing.versionstamp === null) return false;
      const removal = this.#kv.atomic()
        .check(existing)
        .delete(envelope_key(key));
      this.#delete_generation(
        removal,
        key,
        deserialize_envelope(existing.value),
      );
      const commit = await removal.commit();
      if (commit.ok) return true;
    }
    throw new Error("content repository delete contention exhausted retries");
  }

  /** Reassembles one generation, or null when it is no longer complete. */
  async #read_generation(
    key: string,
    envelope: StoredPageEnvelope,
  ): Promise<Uint8Array | null> {
    const chunks: Uint8Array[] = [];
    let total_length = 0;
    for await (
      const chunk_entry of this.#kv.list<unknown>({
        prefix: generation_prefix(key, envelope.generation),
      })
    ) {
      const index = chunk_entry.key[chunk_entry.key.length - 1];
      if (index !== chunks.length) return null;
      if (!(chunk_entry.value instanceof Uint8Array)) invalid_envelope();
      chunks.push(chunk_entry.value);
      total_length += chunk_entry.value.length;
    }
    if (
      chunks.length !== envelope.chunk_count ||
      total_length !== envelope.data_byte_length
    ) {
      return null;
    }
    const bytes = new Uint8Array(total_length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    return bytes;
  }

  #delete_generation(
    operation: Deno.AtomicOperation,
    key: string,
    envelope: StoredPageEnvelope,
  ): void {
    for (let index = 0; index < envelope.chunk_count; index += 1) {
      operation.delete(chunk_key(key, envelope.generation, index));
    }
  }
}

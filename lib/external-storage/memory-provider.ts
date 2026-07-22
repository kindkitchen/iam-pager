import type { ExternalStorageProvider } from "./interfaces.ts";
import {
  external_content_ref_violation,
  type ExternalContentFetchInput,
  type ExternalContentPayload,
  type ExternalContentPutInput,
  type ExternalContentRef,
  type ExternalContentStat,
  type ExternalStorageFailure,
  type ExternalStorageResult,
  is_external_connection_id,
  is_external_fetch_bound,
  is_external_provider_id,
} from "./model.ts";

type FailureReason = ExternalStorageFailure["reason"];

interface StoredContent {
  readonly body: Uint8Array;
  readonly version_hint?: string;
}

/**
 * Process-local reference provider and reusable test double. Stored and
 * returned byte arrays are isolated so callers cannot mutate provider state.
 */
export class MemoryExternalStorageProvider implements ExternalStorageProvider {
  readonly provider_id: string;
  readonly capabilities = ["read", "write", "delete"] as const;

  readonly #content = new Map<string, StoredContent>();
  readonly #faults = new Map<string, FailureReason>();
  #sequence = 0;

  constructor(provider_id = "memory") {
    if (!is_external_provider_id(provider_id)) {
      throw new TypeError(
        `invalid external storage provider ID: ${provider_id}`,
      );
    }
    this.provider_id = provider_id;
  }

  fetch_content(
    input: ExternalContentFetchInput,
  ): Promise<ExternalStorageResult<ExternalContentPayload>> {
    this.#assert_ref(input.content_ref);
    if (!is_external_fetch_bound(input.max_bytes)) {
      throw new TypeError("max_bytes must be a non-negative safe integer");
    }
    const failure = this.#failure(input.content_ref);
    if (failure !== null) return Promise.resolve(failure);

    const stored = this.#content.get(content_key(input.content_ref));
    if (stored === undefined || stored.body.byteLength > input.max_bytes) {
      return Promise.resolve(missing());
    }
    return Promise.resolve({
      ok: true,
      value: {
        body: stored.body.slice(),
        stat: stored_stat(stored),
      },
    });
  }

  stat_content(
    content_ref: ExternalContentRef,
  ): Promise<ExternalStorageResult<ExternalContentStat>> {
    this.#assert_ref(content_ref);
    const failure = this.#failure(content_ref);
    if (failure !== null) return Promise.resolve(failure);

    const stored = this.#content.get(content_key(content_ref));
    return Promise.resolve(
      stored === undefined
        ? missing()
        : { ok: true, value: stored_stat(stored) },
    );
  }

  put_content(
    input: ExternalContentPutInput,
  ): Promise<ExternalStorageResult<ExternalContentRef>> {
    if (!is_external_connection_id(input.connection_id)) {
      throw new TypeError("connection_id must be a route-safe opaque ID");
    }
    if (!(input.body instanceof Uint8Array)) {
      throw new TypeError("body must be a Uint8Array");
    }
    if (typeof input.media_type !== "string" || input.media_type.length === 0) {
      throw new TypeError("media_type must be non-empty");
    }
    if (
      input.download_filename !== undefined &&
      typeof input.download_filename !== "string"
    ) {
      throw new TypeError("download_filename must be a string when present");
    }

    let external_ref: string;
    do {
      this.#sequence += 1;
      external_ref = `memory-object-${this.#sequence}`;
    } while (
      this.#content.has(content_key({
        connection_id: input.connection_id,
        external_ref,
      }))
    );
    const version_hint = `memory-version-${this.#sequence}`;
    const content_ref: ExternalContentRef = {
      provider_id: this.provider_id,
      connection_id: input.connection_id,
      external_ref,
      version_hint,
    };
    this.#content.set(content_key(content_ref), {
      body: input.body.slice(),
      version_hint,
    });
    return Promise.resolve({ ok: true, value: content_ref });
  }

  delete_content(
    content_ref: ExternalContentRef,
  ): Promise<ExternalStorageResult<void>> {
    this.#assert_ref(content_ref);
    const failure = this.#failure(content_ref);
    if (failure !== null) return Promise.resolve(failure);

    if (!this.#content.delete(content_key(content_ref))) {
      return Promise.resolve(missing());
    }
    this.#faults.delete(content_key(content_ref));
    return Promise.resolve({ ok: true, value: undefined });
  }

  /** Seed exact provider content without exercising write capability. */
  seed_content(content_ref: ExternalContentRef, body: Uint8Array): void {
    this.#assert_ref(content_ref);
    if (!(body instanceof Uint8Array)) {
      throw new TypeError("body must be a Uint8Array");
    }
    this.#content.set(content_key(content_ref), {
      body: body.slice(),
      version_hint: content_ref.version_hint,
    });
  }

  /** Inject or clear one normalized provider failure for deterministic tests. */
  set_fault(
    content_ref: ExternalContentRef,
    reason: FailureReason | null,
  ): void {
    this.#assert_ref(content_ref);
    const key = content_key(content_ref);
    if (reason === null) {
      this.#faults.delete(key);
      return;
    }
    this.#faults.set(key, reason);
  }

  #assert_ref(content_ref: ExternalContentRef): void {
    const violation = external_content_ref_violation(content_ref);
    if (violation !== null) throw new TypeError(violation);
    if (content_ref.provider_id !== this.provider_id) {
      throw new TypeError(
        `content reference belongs to another provider: ${content_ref.provider_id}`,
      );
    }
  }

  #failure(content_ref: ExternalContentRef): ExternalStorageFailure | null {
    const reason = this.#faults.get(content_key(content_ref));
    if (reason === undefined) return null;
    if (reason === "external_content_missing") return missing();
    if (reason === "connection_revoked") return revoked();
    return unreachable();
  }
}

function content_key(
  content_ref: Pick<ExternalContentRef, "connection_id" | "external_ref">,
): string {
  return JSON.stringify([content_ref.connection_id, content_ref.external_ref]);
}

function stored_stat(content: StoredContent): ExternalContentStat {
  return {
    size_bytes: content.body.byteLength,
    ...(content.version_hint === undefined
      ? {}
      : { version_hint: content.version_hint }),
  };
}

function missing(): ExternalStorageFailure {
  return { ok: false, reason: "external_content_missing" };
}

function revoked(): ExternalStorageFailure {
  return { ok: false, reason: "connection_revoked" };
}

function unreachable(): ExternalStorageFailure {
  return { ok: false, reason: "external_source_unreachable" };
}

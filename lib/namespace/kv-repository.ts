import type { KvRecordGateway } from "../storage/kv-gateway.ts";
import { ownership_database_schema_version } from "../storage/schema-versions.ts";
import type {
  NamespaceRepository,
  ReserveRequest,
  ReserveResult,
} from "./interfaces.ts";
import { namespace_key, type NamespaceReservation } from "./model.ts";

const storage_schema_version = ownership_database_schema_version;
// Key paths stay stable across value-schema upgrades so uniqueness cannot fork.
const reservation_prefix: Deno.KvKey = [
  "iam-pager",
  "namespace-reservations",
  "by-namespace",
];
const owner_prefix: Deno.KvKey = [
  "iam-pager",
  "namespace-reservations",
  "by-owner",
];

interface StoredNamespaceReservation {
  readonly schema_version: 1;
  readonly namespace: string;
  readonly owner_user_id: string;
  readonly reserved_at: string;
}

function namespace_reservation_key(namespace: string): Deno.KvKey {
  return [...reservation_prefix, namespace_key(namespace)];
}

function namespace_owner_prefix(owner_user_id: string): Deno.KvKey {
  return [...owner_prefix, owner_user_id];
}

function namespace_owner_key(
  owner_user_id: string,
  normalized_namespace: string,
): Deno.KvKey {
  return [...namespace_owner_prefix(owner_user_id), normalized_namespace];
}

function serialize_reservation(
  reservation: NamespaceReservation,
): StoredNamespaceReservation {
  return {
    schema_version: storage_schema_version,
    namespace: reservation.namespace,
    owner_user_id: reservation.owner_user_id,
    reserved_at: reservation.reserved_at.toISOString(),
  };
}

function deserialize_reservation(value: unknown): NamespaceReservation {
  if (typeof value !== "object" || value === null) {
    throw new TypeError("invalid stored namespace reservation");
  }
  const stored = value as Record<string, unknown>;
  if (
    stored.schema_version !== storage_schema_version ||
    typeof stored.namespace !== "string" ||
    typeof stored.owner_user_id !== "string" ||
    typeof stored.reserved_at !== "string"
  ) {
    throw new TypeError("invalid stored namespace reservation");
  }
  const reserved_at = new Date(stored.reserved_at);
  if (
    Number.isNaN(reserved_at.getTime()) ||
    reserved_at.toISOString() !== stored.reserved_at
  ) {
    throw new TypeError("invalid stored namespace reservation");
  }
  return {
    namespace: stored.namespace,
    owner_user_id: stored.owner_user_id,
    reserved_at,
  };
}

/**
 * Deno KV-backed namespace reservations.
 *
 * The namespace record and owner-list index are written in one atomic commit.
 * The primary key's versionstamp is checked as absent, so concurrent claimers
 * across processes still produce exactly one winner without weakening the
 * `NamespaceRepository` contract.
 */
export class DenoKvNamespaceRepository implements NamespaceRepository {
  readonly #kv: KvRecordGateway;
  readonly #now: () => Date;

  constructor(kv: KvRecordGateway, options: { now?: () => Date } = {}) {
    this.#kv = kv;
    this.#now = options.now ?? (() => new Date());
  }

  async reserve(request: ReserveRequest): Promise<ReserveResult> {
    const namespace = request.namespace;
    const owner_user_id = request.owner_user_id;
    const normalized_namespace = namespace_key(namespace);
    const key = namespace_reservation_key(namespace);
    const existing = await this.#kv.get<StoredNamespaceReservation>(key);
    if (existing.versionstamp !== null) {
      return { ok: false, reason: "taken" };
    }

    const reservation: NamespaceReservation = {
      namespace,
      owner_user_id,
      reserved_at: this.#now(),
    };
    const stored = serialize_reservation(reservation);
    const commit = await this.#kv.native_atomic()
      .check(existing)
      .set(key, stored)
      .set(
        namespace_owner_key(owner_user_id, normalized_namespace),
        stored,
      )
      .commit();

    return commit.ok
      ? { ok: true, reservation }
      : { ok: false, reason: "taken" };
  }

  async find(namespace: string): Promise<NamespaceReservation | null> {
    const entry = await this.#kv.get<unknown>(
      namespace_reservation_key(namespace),
    );
    if (entry.versionstamp === null) return null;
    const reservation = deserialize_reservation(entry.value);
    if (namespace_key(reservation.namespace) !== namespace_key(namespace)) {
      throw new Error("namespace repository invariant violated");
    }
    return reservation;
  }

  async list_by_owner(
    owner_user_id: string,
  ): Promise<NamespaceReservation[]> {
    const reservations: NamespaceReservation[] = [];
    for await (
      const entry of this.#kv.list<unknown>({
        prefix: namespace_owner_prefix(owner_user_id),
      })
    ) {
      const reservation = deserialize_reservation(entry.value);
      const indexed_namespace = entry.key[entry.key.length - 1];
      if (
        reservation.owner_user_id !== owner_user_id ||
        indexed_namespace !== namespace_key(reservation.namespace)
      ) {
        throw new Error("namespace repository invariant violated");
      }
      reservations.push(reservation);
    }
    return reservations;
  }
}

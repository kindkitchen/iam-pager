export interface KvRecordGateway {
  get<T = unknown>(
    key: Deno.KvKey,
    options?: { consistency?: Deno.KvConsistencyLevel },
  ): Promise<Deno.KvEntryMaybe<T>>;

  get_many<T extends readonly unknown[]>(
    keys: readonly [...{ [K in keyof T]: Deno.KvKey }],
    options?: { consistency?: Deno.KvConsistencyLevel },
  ): Promise<{ [K in keyof T]: Deno.KvEntryMaybe<T[K]> }>;

  list<T = unknown>(
    selector: Deno.KvListSelector,
    options?: Deno.KvListOptions,
  ): Deno.KvListIterator<T>;

  set(
    key: Deno.KvKey,
    value: unknown,
    options?: { expireIn?: number },
  ): Promise<Deno.KvCommitResult>;

  delete(key: Deno.KvKey): Promise<void>;

  /** One native all-or-none Deno KV operation; never a split batch. */
  native_atomic(): Deno.AtomicOperation;
}

export interface KvBinaryObjectMetadata {
  readonly byte_length: number;
  readonly versionstamp: string;
}

export interface KvBinaryObjectGateway {
  /**
   * Writes detached non-empty bytes under an unreachable, caller-random key.
   * The key must not already identify a complete binary object.
   */
  stage_binary_object(key: Deno.KvKey, bytes: Uint8Array): Promise<void>;

  /** Reads detached bytes and rejects incomplete or length-incoherent state. */
  read_binary_object(key: Deno.KvKey): Promise<Uint8Array | null>;

  get_binary_object_metadata(
    key: Deno.KvKey,
  ): Promise<KvBinaryObjectMetadata | null>;

  remove_binary_object(key: Deno.KvKey): Promise<void>;
}

/** Project-owned persistence boundary; concrete utility types never cross it. */
export interface KvGateway extends KvRecordGateway, KvBinaryObjectGateway {
  close(): void;
}

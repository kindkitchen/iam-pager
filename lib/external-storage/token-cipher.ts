import { decode_base64url } from "../base64url.ts";
import { is_exact_record } from "../storage/record.ts";
import {
  assert_storage_connection_credentials,
  clone_storage_connection_credentials,
  type StorageConnectionCredentials,
} from "./connection-model.ts";
import { is_external_connection_id } from "./model.ts";

export const STORAGE_TOKEN_KEY_ENV = "IAM_PAGER_STORAGE_TOKEN_KEY";
const envelope_version = 1;
const iv_length = 12;
const key_length = 32;
const text_encoder = new TextEncoder();
const text_decoder = new TextDecoder("utf-8", { fatal: true });

/** Authenticated ciphertext persisted separately from connection metadata. */
export interface EncryptedStorageCredentials {
  readonly version: 1;
  readonly iv: Uint8Array;
  readonly ciphertext: Uint8Array;
}

/** Project-owned token-custody boundary; persistence never handles raw keys. */
export interface StorageCredentialCipher {
  encrypt(
    connection_id: string,
    credentials: StorageConnectionCredentials,
  ): Promise<EncryptedStorageCredentials>;
  decrypt(
    connection_id: string,
    encrypted: EncryptedStorageCredentials,
  ): Promise<StorageConnectionCredentials>;
}

/**
 * AES-256-GCM credential custody. The connection ID is authenticated as
 * additional data, so ciphertext cannot be moved between connections.
 */
export class AesGcmStorageCredentialCipher implements StorageCredentialCipher {
  readonly #key: CryptoKey;

  private constructor(key: CryptoKey) {
    this.#key = key;
  }

  static async from_key_bytes(
    key_bytes: Uint8Array,
  ): Promise<AesGcmStorageCredentialCipher> {
    if (
      !(key_bytes instanceof Uint8Array) || key_bytes.byteLength !== key_length
    ) {
      throw new TypeError("storage token key must contain exactly 32 bytes");
    }
    const key = await crypto.subtle.importKey(
      "raw",
      key_bytes.slice(),
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    return new AesGcmStorageCredentialCipher(key);
  }

  static async from_base64url_key(
    encoded_key: string,
  ): Promise<AesGcmStorageCredentialCipher> {
    const key_bytes = decode_base64url(encoded_key);
    if (key_bytes === null || key_bytes.byteLength !== key_length) {
      throw new TypeError(
        `${STORAGE_TOKEN_KEY_ENV} must be canonical base64url for exactly 32 bytes`,
      );
    }
    return await AesGcmStorageCredentialCipher.from_key_bytes(key_bytes);
  }

  async encrypt(
    connection_id: string,
    credentials: StorageConnectionCredentials,
  ): Promise<EncryptedStorageCredentials> {
    assert_connection_id(connection_id);
    assert_storage_connection_credentials(credentials);
    const iv = crypto.getRandomValues(new Uint8Array(iv_length));
    const plaintext = text_encoder.encode(JSON.stringify(
      serialize_credentials(credentials),
    ));
    const ciphertext = new Uint8Array(
      await crypto.subtle.encrypt(
        algorithm(connection_id, iv),
        this.#key,
        plaintext,
      ),
    );
    return { version: envelope_version, iv, ciphertext };
  }

  async decrypt(
    connection_id: string,
    encrypted: EncryptedStorageCredentials,
  ): Promise<StorageConnectionCredentials> {
    assert_connection_id(connection_id);
    assert_envelope(encrypted);
    try {
      const plaintext = await crypto.subtle.decrypt(
        algorithm(connection_id, encrypted.iv),
        this.#key,
        encrypted.ciphertext.slice().buffer as ArrayBuffer,
      );
      const decoded: unknown = JSON.parse(text_decoder.decode(plaintext));
      return deserialize_credentials(decoded);
    } catch {
      throw new TypeError("invalid encrypted storage credentials");
    }
  }
}

function algorithm(connection_id: string, iv: Uint8Array): AesGcmParams {
  return {
    name: "AES-GCM",
    iv: iv.slice().buffer as ArrayBuffer,
    additionalData: text_encoder.encode(
      `iam-pager/storage-credentials/v1/${connection_id}`,
    ),
    tagLength: 128,
  };
}

function assert_connection_id(connection_id: string): void {
  if (!is_external_connection_id(connection_id)) {
    throw new TypeError("connection_id must be a route-safe opaque ID");
  }
}

function assert_envelope(
  value: unknown,
): asserts value is EncryptedStorageCredentials {
  if (!is_exact_record(value, ["version", "iv", "ciphertext"])) {
    throw new TypeError("invalid encrypted storage credentials");
  }
  const encrypted = value as unknown as EncryptedStorageCredentials;
  if (
    encrypted.version !== envelope_version ||
    !(encrypted.iv instanceof Uint8Array) ||
    encrypted.iv.byteLength !== iv_length ||
    !(encrypted.ciphertext instanceof Uint8Array) ||
    encrypted.ciphertext.byteLength <= 16
  ) {
    throw new TypeError("invalid encrypted storage credentials");
  }
}

interface SerializedCredentials {
  readonly access_token: string;
  readonly refresh_token?: string;
  readonly access_token_expires_at?: string;
}

function serialize_credentials(
  credentials: StorageConnectionCredentials,
): SerializedCredentials {
  return {
    access_token: credentials.access_token,
    ...(credentials.refresh_token === undefined
      ? {}
      : { refresh_token: credentials.refresh_token }),
    ...(credentials.access_token_expires_at === undefined ? {} : {
      access_token_expires_at: credentials.access_token_expires_at
        .toISOString(),
    }),
  };
}

function deserialize_credentials(value: unknown): StorageConnectionCredentials {
  if (
    !is_exact_record(
      value,
      ["access_token"],
      ["refresh_token", "access_token_expires_at"],
    )
  ) {
    throw new TypeError("invalid encrypted storage credentials");
  }
  const stored = value as unknown as SerializedCredentials;
  const expires_at = stored.access_token_expires_at === undefined
    ? undefined
    : new Date(stored.access_token_expires_at);
  const credentials: StorageConnectionCredentials = {
    access_token: stored.access_token,
    ...(stored.refresh_token === undefined
      ? {}
      : { refresh_token: stored.refresh_token }),
    ...(expires_at === undefined
      ? {}
      : { access_token_expires_at: expires_at }),
  };
  assert_storage_connection_credentials(credentials);
  return clone_storage_connection_credentials(credentials);
}

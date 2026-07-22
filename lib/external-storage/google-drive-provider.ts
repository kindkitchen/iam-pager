import type { Clock } from "../session/interfaces.ts";
import type { ExternalStorageProvider } from "./interfaces.ts";
import type {
  StorageConnection,
  StorageConnectionCredentials,
} from "./connection-model.ts";
import type { StorageConnectionRepository } from "./connection-repository.ts";
import type {
  GoogleDriveGateway,
  GoogleDriveGatewayResult,
} from "./google-drive-gateway.ts";
import { google_drive_provider_id } from "./google-drive-oauth.ts";
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
} from "./model.ts";

const refresh_leeway_ms = 60_000;

type CredentialResult =
  | { readonly ok: true; readonly value: StorageConnectionCredentials }
  | ExternalStorageFailure;

/** Google Drive implementation of the provider-neutral external storage API. */
export class GoogleDriveExternalStorageProvider
  implements ExternalStorageProvider {
  readonly provider_id = google_drive_provider_id;
  readonly capabilities = ["read", "write"] as const;

  readonly #connections: StorageConnectionRepository;
  readonly #gateway: GoogleDriveGateway;
  readonly #clock: Clock;
  readonly #refreshes = new Map<string, Promise<CredentialResult>>();

  constructor(options: {
    connections: StorageConnectionRepository;
    gateway: GoogleDriveGateway;
    clock?: Clock;
  }) {
    this.#connections = options.connections;
    this.#gateway = options.gateway;
    this.#clock = options.clock ?? { now: () => new Date() };
  }

  fetch_content(
    input: ExternalContentFetchInput,
  ): Promise<ExternalStorageResult<ExternalContentPayload>> {
    this.#assert_ref(input.content_ref);
    if (!is_external_fetch_bound(input.max_bytes)) {
      throw new TypeError("max_bytes must be a non-negative safe integer");
    }
    return this.#execute<ExternalContentPayload>(
      input.content_ref.connection_id,
      async (access_token) => {
        const stated = await this.#gateway.stat_file({
          access_token,
          file_id: input.content_ref.external_ref,
        });
        if (!stated.ok) return stated;
        const stat = normalize_stat(input.content_ref, stated.value);
        if (!stat.ok) return stat;
        if (stat.value.size_bytes > input.max_bytes) return missing_gateway();

        const fetched = await this.#gateway.fetch_file({
          access_token,
          file_id: input.content_ref.external_ref,
          max_bytes: input.max_bytes,
        });
        if (!fetched.ok) return fetched;
        if (fetched.value.byteLength !== stat.value.size_bytes) {
          return missing_gateway();
        }
        return {
          ok: true,
          value: { body: fetched.value.slice(), stat: stat.value },
        };
      },
    );
  }

  stat_content(
    content_ref: ExternalContentRef,
  ): Promise<ExternalStorageResult<ExternalContentStat>> {
    this.#assert_ref(content_ref);
    return this.#execute<ExternalContentStat>(
      content_ref.connection_id,
      async (access_token) => {
        const stated = await this.#gateway.stat_file({
          access_token,
          file_id: content_ref.external_ref,
        });
        if (!stated.ok) return stated;
        return normalize_stat(content_ref, stated.value);
      },
    );
  }

  put_content(
    input: ExternalContentPutInput,
  ): Promise<ExternalStorageResult<ExternalContentRef>> {
    validate_put_input(input);
    return this.#execute<ExternalContentRef>(
      input.connection_id,
      async (access_token) => {
        const uploaded = await this.#gateway.put_file({
          access_token,
          body: input.body,
          media_type: input.media_type,
          filename: input.download_filename ?? "iam-pager-content",
        });
        if (!uploaded.ok) return uploaded;
        if (
          uploaded.value.trashed ||
          uploaded.value.size_bytes !== input.body.byteLength ||
          uploaded.value.md5_checksum === undefined ||
          uploaded.value.md5_checksum.length === 0
        ) return { ok: false, reason: "provider_error" };
        return {
          ok: true,
          value: {
            provider_id: this.provider_id,
            connection_id: input.connection_id,
            external_ref: uploaded.value.file_id,
            version_hint: uploaded.value.md5_checksum,
          },
        };
      },
    );
  }

  async #execute<T>(
    connection_id: string,
    operation: (
      access_token: string,
    ) => Promise<GoogleDriveGatewayResult<T>>,
  ): Promise<ExternalStorageResult<T>> {
    let connection: StorageConnection | null;
    let credentials: StorageConnectionCredentials | null;
    try {
      connection = await this.#connections.find_by_id(connection_id);
      credentials = await this.#connections.get_credentials(connection_id);
    } catch {
      return unreachable();
    }
    if (
      connection === null || connection.status !== "active" ||
      connection.provider_id !== this.provider_id || credentials === null
    ) return missing();

    if (credentials_need_refresh(credentials, this.#clock.now())) {
      const refreshed = await this.#refresh(connection, credentials);
      if (!refreshed.ok) return refreshed;
      credentials = refreshed.value;
    }

    let result = await operation(credentials.access_token);
    if (!result.ok && result.reason === "unauthorized") {
      let retry_credentials: CredentialResult;
      try {
        const current = await this.#connections.get_credentials(connection_id);
        retry_credentials = current !== null &&
            current.access_token !== credentials.access_token
          ? { ok: true, value: current }
          : await this.#refresh(connection, credentials);
      } catch {
        return unreachable();
      }
      if (!retry_credentials.ok) return retry_credentials;
      result = await operation(retry_credentials.value.access_token);
      if (!result.ok && result.reason === "unauthorized") {
        await this.#revoke(connection);
        return missing();
      }
    }
    return normalize_gateway_result(result);
  }

  #refresh(
    connection: StorageConnection,
    credentials: StorageConnectionCredentials,
  ): Promise<CredentialResult> {
    const existing = this.#refreshes.get(connection.connection_id);
    if (existing !== undefined) return existing;
    const refreshing = this.#perform_refresh(connection, credentials)
      .finally(() => this.#refreshes.delete(connection.connection_id));
    this.#refreshes.set(connection.connection_id, refreshing);
    return refreshing;
  }

  async #perform_refresh(
    connection: StorageConnection,
    credentials: StorageConnectionCredentials,
  ): Promise<CredentialResult> {
    if (credentials.refresh_token === undefined) {
      await this.#revoke(connection);
      return missing();
    }
    const refreshed = await this.#gateway.refresh_access_token({
      refresh_token: credentials.refresh_token,
    });
    if (!refreshed.ok) {
      if (
        refreshed.reason === "invalid_grant" ||
        refreshed.reason === "unauthorized"
      ) {
        await this.#revoke(connection);
        return missing();
      }
      return normalize_gateway_result(refreshed);
    }
    const next_credentials: StorageConnectionCredentials = {
      access_token: refreshed.value.access_token,
      refresh_token: refreshed.value.refresh_token ?? credentials.refresh_token,
      access_token_expires_at: refreshed.value.expires_at,
    };
    try {
      if (
        !await this.#connections.put_credentials(
          connection.connection_id,
          next_credentials,
        )
      ) return missing();
    } catch {
      return unreachable();
    }
    return { ok: true, value: next_credentials };
  }

  async #revoke(connection: StorageConnection): Promise<void> {
    try {
      await this.#connections.revoke(
        connection.connection_id,
        connection.user_id,
        this.#clock.now(),
      );
    } catch {
      // The caller still receives a non-disclosing definitive failure.
    }
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
}

function normalize_stat(
  content_ref: ExternalContentRef,
  file: {
    readonly file_id: string;
    readonly size_bytes: number;
    readonly md5_checksum?: string;
    readonly trashed: boolean;
  },
): GoogleDriveGatewayResult<ExternalContentStat> {
  if (file.file_id !== content_ref.external_ref || file.trashed) {
    return missing_gateway();
  }
  if (
    content_ref.version_hint !== undefined &&
    content_ref.version_hint !== file.md5_checksum
  ) return missing_gateway();
  return {
    ok: true,
    value: {
      size_bytes: file.size_bytes,
      ...(file.md5_checksum === undefined
        ? {}
        : { version_hint: file.md5_checksum }),
    },
  };
}

function normalize_gateway_result<T>(
  result: GoogleDriveGatewayResult<T>,
): ExternalStorageResult<T> {
  if (result.ok) return result;
  if (
    result.reason === "missing" || result.reason === "unauthorized" ||
    result.reason === "invalid_grant"
  ) return missing();
  return {
    ok: false,
    reason: "external_source_unreachable",
    ...(result.retry_after_seconds === undefined
      ? {}
      : { retry_after_seconds: result.retry_after_seconds }),
  };
}

function credentials_need_refresh(
  credentials: StorageConnectionCredentials,
  now: Date,
): boolean {
  return credentials.access_token_expires_at !== undefined &&
    credentials.access_token_expires_at.getTime() <=
      now.getTime() + refresh_leeway_ms;
}

function validate_put_input(input: ExternalContentPutInput): void {
  if (!is_external_connection_id(input.connection_id)) {
    throw new TypeError("connection_id must be a route-safe opaque ID");
  }
  if (!(input.body instanceof Uint8Array)) {
    throw new TypeError("body must be a Uint8Array");
  }
  if (
    typeof input.media_type !== "string" || input.media_type.length === 0 ||
    /[\r\n]/.test(input.media_type)
  ) throw new TypeError("media_type must be non-empty and header-safe");
  if (
    input.download_filename !== undefined &&
    (typeof input.download_filename !== "string" ||
      input.download_filename.length === 0 ||
      /[\r\n]/.test(input.download_filename))
  ) throw new TypeError("download_filename must be non-empty and header-safe");
}

function missing_gateway(): GoogleDriveGatewayResult<never> {
  return { ok: false, reason: "missing" };
}

function missing(): ExternalStorageFailure {
  return { ok: false, reason: "external_content_missing" };
}

function unreachable(): ExternalStorageFailure {
  return { ok: false, reason: "external_source_unreachable" };
}

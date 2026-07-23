import type { Session } from "../session/model.ts";
import type { StorageConnection } from "./connection-model.ts";
import type { StorageConnectionRepository } from "./connection-repository.ts";
import type { GoogleDriveConnectionManager } from "./google-drive-connection-service.ts";
import type { ExternalStorageProviderResolver } from "./interfaces.ts";
import {
  type ExternalStorageCapability,
  is_external_provider_id,
} from "./model.ts";

export interface ManagedStorageConnection {
  readonly connection_id: string;
  readonly provider_id: string;
  readonly provider_label: string;
  readonly provider_subject: string;
  readonly scopes: readonly string[];
  readonly status: "active" | "revoked";
  readonly capabilities: readonly ExternalStorageCapability[];
  readonly created_at: Date;
  readonly updated_at: Date;
}

export interface StorageConnectionLifecycle {
  readonly provider_id: string;
  readonly provider_label: string;
  readonly connect_path: string;
  disconnect(
    session: Session,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
}

export interface StorageConnectionConnectOption {
  readonly provider_id: string;
  readonly label: string;
  readonly action: string;
}

export interface StorageConnectionManagement {
  list_owned(user_id: string): Promise<ManagedStorageConnection[]>;
  connect_options(): readonly StorageConnectionConnectOption[];
  connect_path(provider_id: string): string | null;
  disconnect(
    session: Session,
    provider_id: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }>;
}

/** Adapts the Google-specific OAuth manager to the additive lifecycle family. */
export class GoogleDriveStorageConnectionLifecycle
  implements StorageConnectionLifecycle {
  readonly provider_id = "google-drive";
  readonly provider_label = "Google Drive";
  readonly connect_path = "/auth/storage/google-drive/start";
  readonly #connections: GoogleDriveConnectionManager;

  constructor(connections: GoogleDriveConnectionManager) {
    this.#connections = connections;
  }

  async disconnect(
    session: Session,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const result = await this.#connections.disconnect(session);
    return result.ok ? { ok: true } : result;
  }
}

/** Provider-neutral creator management over owner-safe connection metadata. */
export class StorageConnectionManagementService
  implements StorageConnectionManagement {
  readonly #connections: StorageConnectionRepository;
  readonly #providers: ExternalStorageProviderResolver;
  readonly #lifecycles = new Map<string, StorageConnectionLifecycle>();

  constructor(options: {
    connections: StorageConnectionRepository;
    providers: ExternalStorageProviderResolver;
    lifecycles: readonly StorageConnectionLifecycle[];
  }) {
    this.#connections = options.connections;
    this.#providers = options.providers;
    for (const lifecycle of options.lifecycles) {
      if (!is_external_provider_id(lifecycle.provider_id)) {
        throw new TypeError("storage lifecycle provider_id is invalid");
      }
      if (
        lifecycle.provider_label.trim() === "" ||
        !lifecycle.connect_path.startsWith("/") ||
        lifecycle.connect_path.startsWith("//") ||
        this.#lifecycles.has(lifecycle.provider_id)
      ) {
        throw new TypeError("storage lifecycle descriptor is invalid");
      }
      this.#lifecycles.set(lifecycle.provider_id, lifecycle);
    }
  }

  async list_owned(user_id: string): Promise<ManagedStorageConnection[]> {
    const connections = await this.#connections.list_by_user(user_id);
    return connections
      .sort((left, right) =>
        right.updated_at.getTime() - left.updated_at.getTime()
      )
      .map((connection) => this.#present(connection));
  }

  connect_options(): readonly StorageConnectionConnectOption[] {
    return [...this.#lifecycles.values()].map((lifecycle) => ({
      provider_id: lifecycle.provider_id,
      label: lifecycle.provider_label,
      action: lifecycle.connect_path,
    }));
  }

  connect_path(provider_id: string): string | null {
    return this.#lifecycles.get(provider_id)?.connect_path ?? null;
  }

  async disconnect(
    session: Session,
    provider_id: string,
  ): Promise<{ ok: true } | { ok: false; reason: string }> {
    const lifecycle = this.#lifecycles.get(provider_id);
    return lifecycle === undefined
      ? { ok: false, reason: "provider_not_supported" }
      : await lifecycle.disconnect(session);
  }

  #present(connection: StorageConnection): ManagedStorageConnection {
    const provider = this.#providers.resolve(connection.provider_id);
    return {
      connection_id: connection.connection_id,
      provider_id: connection.provider_id,
      provider_label: this.#lifecycles.get(connection.provider_id)
        ?.provider_label ?? provider_label(connection.provider_id),
      provider_subject: connection.provider_subject,
      scopes: [...connection.scopes],
      status: connection.status,
      capabilities: provider === null ? [] : [...provider.capabilities],
      created_at: new Date(connection.created_at),
      updated_at: new Date(connection.updated_at),
    };
  }
}

export function provider_label(provider_id: string): string {
  return provider_id === "google-drive" ? "Google Drive" : provider_id;
}

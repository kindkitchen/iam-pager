import type { Session } from "../session/model.ts";
import type {
  ManagedStorageConnection,
  StorageConnectionManagement,
} from "../external-storage/connection-management.ts";

export interface WritableStorageOption {
  readonly provider_id: string;
  readonly label: string;
}

export type StorageConnectionPanel =
  | { readonly kind: "guest" }
  | {
    readonly kind: "creator";
    readonly csrf_token: string;
    readonly connections: readonly ManagedStorageConnection[];
    readonly connect_options: readonly {
      provider_id: string;
      label: string;
      action: string;
    }[];
    readonly writable_options: readonly WritableStorageOption[];
  };

export interface StorageConnectionPanelPresenter {
  present(session: Session): Promise<StorageConnectionPanel>;
}

/** Derives creator-safe settings and publishing choices from raw capabilities. */
export class CreatorStorageConnectionPanelPresenter
  implements StorageConnectionPanelPresenter {
  readonly #management: StorageConnectionManagement;

  constructor(management: StorageConnectionManagement) {
    this.#management = management;
  }

  async present(session: Session): Promise<StorageConnectionPanel> {
    if (session.kind !== "authenticated") return { kind: "guest" };
    const connections = await this.#management.list_owned(session.user_id);
    const writable_provider_ids = new Set(
      connections
        .filter((connection) =>
          connection.status === "active" &&
          connection.capabilities.includes("write")
        )
        .map((connection) => connection.provider_id),
    );
    return {
      kind: "creator",
      csrf_token: session.csrf_token,
      connections,
      connect_options: this.#management.connect_options(),
      writable_options: connections
        .filter((connection) =>
          writable_provider_ids.has(connection.provider_id)
        )
        .filter((connection, index, all) =>
          all.findIndex((candidate) =>
            candidate.provider_id === connection.provider_id
          ) === index
        )
        .map((connection) => ({
          provider_id: connection.provider_id,
          label: connection.provider_label,
        })),
    };
  }
}

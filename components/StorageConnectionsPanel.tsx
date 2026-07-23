import type { StorageConnectionPanel as StorageConnectionPanelModel } from "../lib/ui/storage-connections.ts";

export function StorageConnectionsPanel(
  { panel }: { readonly panel: StorageConnectionPanelModel },
) {
  if (panel.kind !== "creator") return null;
  const active_google_drive = panel.connections.some((connection) =>
    connection.provider_id === "google-drive" && connection.status === "active"
  );
  return (
    <section
      class="storage-connections-panel"
      aria-labelledby="storage-connections-heading"
    >
      <div class="section-heading">
        <p class="eyebrow">Content custody</p>
        <h2 id="storage-connections-heading">Connected storages</h2>
        <p>
          Connect storage for new external publications. iam-pager keeps page
          metadata locally and serves verified provider bytes without exposing
          credentials.
        </p>
      </div>

      {panel.connections.length === 0
        ? <p>No storage accounts connected.</p>
        : (
          <ul class="storage-connection-list">
            {panel.connections.map((connection) => (
              <li key={connection.connection_id}>
                <div>
                  <strong>{connection.provider_label}</strong>
                  <span>{connection.provider_subject}</span>
                  <small>
                    {connection.status} · {connection.scopes.join(", ")}
                  </small>
                </div>
                {connection.status === "active" &&
                  connection.provider_id === "google-drive" && (
                  <form
                    action="/auth/storage/google-drive/disconnect"
                    method="post"
                  >
                    <input
                      type="hidden"
                      name="csrf_token"
                      value={panel.csrf_token}
                      autocomplete="off"
                    />
                    <button class="page-management-danger" type="submit">
                      Disconnect
                    </button>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

      {active_google_drive && (
        <p class="field-hint">
          Disconnecting is not blocked by dependent pages. Those pages become
          unavailable until their content is re-linked or replaced.
        </p>
      )}

      <div class="storage-connection-actions">
        {panel.connect_options.map((option) => (
          <a class="context-button" href={option.action}>
            {active_google_drive && option.provider_id === "google-drive"
              ? `Reconnect ${option.label}`
              : `Connect ${option.label}`}
          </a>
        ))}
      </div>
    </section>
  );
}

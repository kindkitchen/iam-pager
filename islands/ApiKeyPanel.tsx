import type { JSX } from "preact";
import { useState } from "preact/hooks";
import {
  api_key_all_permissions_shorthand,
  api_key_draft_violation,
  api_key_panel_failure,
  api_key_permission_choices,
  type ApiKeyPanelDraft,
  type ApiKeyPanelKey,
  generated_api_key_from_api,
  panel_key_from_api,
  panel_key_list_from_api,
  prepare_api_key_create_request,
  prepare_api_key_list_request,
  prepare_api_key_revoke_all_request,
  prepare_api_key_revoke_request,
  prepare_api_key_update_request,
  type PreparedApiKeyRequest,
  revoked_count_from_api,
} from "../lib/ui/api-key-panel.ts";

interface GeneratedReveal {
  readonly api_key_id: string;
  readonly label: string;
  readonly bearer: string;
}

type PanelNotice =
  | { readonly kind: "none" }
  | { readonly kind: "error"; readonly message: string }
  | { readonly kind: "info"; readonly message: string };

interface DraftState {
  label: string;
  permissions: readonly string[];
  all_access: boolean;
  expires_at_local: string;
}

const empty_draft: DraftState = {
  label: "",
  permissions: [],
  all_access: false,
  expires_at_local: "",
};

export interface ApiKeyPanelProps {
  /** Synchronizer token minted server-side for the authenticated session. */
  csrf_token: string;
  /** Server-rendered snapshot; mutations replace it via the API. */
  initial_api_keys: readonly ApiKeyPanelKey[];
}

/** Creator panel for owned API keys: generate, copy, edit, revoke. */
export default function ApiKeyPanel(props: ApiKeyPanelProps) {
  const [keys, set_keys] = useState(props.initial_api_keys);
  const [draft, set_draft] = useState<DraftState>(empty_draft);
  const [busy, set_busy] = useState(false);
  const [notice, set_notice] = useState<PanelNotice>({ kind: "none" });
  const [generated, set_generated] = useState<GeneratedReveal | null>(null);
  const [copied, set_copied] = useState(false);
  const [editing, set_editing] = useState<string | null>(null);
  const [edit_draft, set_edit_draft] = useState<DraftState>(empty_draft);
  const [confirm_revoke, set_confirm_revoke] = useState<string | null>(null);
  const [confirm_revoke_all, set_confirm_revoke_all] = useState(false);

  function to_draft(state: DraftState): ApiKeyPanelDraft {
    return {
      label: state.label,
      permissions: state.all_access
        ? [api_key_all_permissions_shorthand]
        : state.permissions,
      expires_at: state.expires_at_local === ""
        ? null
        : local_input_to_iso(state.expires_at_local),
    };
  }

  async function send(prepared: PreparedApiKeyRequest): Promise<
    { ok: true; status: number; body: unknown } | { ok: false }
  > {
    try {
      const response = await fetch(prepared.url, {
        method: prepared.method,
        headers: prepared.headers,
        ...(prepared.body === undefined
          ? {}
          : { body: JSON.stringify(prepared.body) }),
      });
      const body = response.status === 204 ? null : await response.json();
      return { ok: true, status: response.status, body };
    } catch (error) {
      set_notice({
        kind: "error",
        message: error instanceof Error ? error.message : String(error),
      });
      return { ok: false };
    }
  }

  async function refresh_keys(): Promise<void> {
    const result = await send(prepare_api_key_list_request());
    if (!result.ok) return;
    const listed = panel_key_list_from_api(result.body);
    if (listed !== null) set_keys(listed);
  }

  async function handle_failure(status: number, body: unknown): Promise<void> {
    const failure = api_key_panel_failure(status, body);
    set_notice({ kind: "error", message: failure.message });
    if (failure.kind === "stale") await refresh_keys();
  }

  async function generate(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
    event.preventDefault();
    const candidate = to_draft(draft);
    const violation = api_key_draft_violation(candidate, new Date());
    if (violation !== null) {
      set_notice({ kind: "error", message: violation });
      return;
    }
    set_busy(true);
    set_notice({ kind: "none" });
    const result = await send(
      prepare_api_key_create_request(props.csrf_token, candidate),
    );
    set_busy(false);
    if (!result.ok) return;
    const created = result.status === 201
      ? generated_api_key_from_api(result.body)
      : null;
    if (created === null) {
      await handle_failure(result.status, result.body);
      return;
    }
    set_keys((current) => [...current, created.api_key]);
    set_draft(empty_draft);
    set_copied(false);
    set_generated({
      api_key_id: created.api_key.api_key_id,
      label: created.api_key.label,
      bearer: created.bearer,
    });
  }

  async function copy_bearer(bearer: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(bearer);
      set_copied(true);
    } catch {
      set_notice({
        kind: "error",
        message: "Copy failed. Select the key text and copy it manually.",
      });
    }
  }

  function start_edit(key: ApiKeyPanelKey): void {
    set_editing(key.api_key_id);
    set_confirm_revoke(null);
    set_edit_draft({
      label: key.label,
      permissions: key.permissions,
      all_access: key.permissions.length === api_key_permission_choices.length,
      expires_at_local: key.expires_at === null
        ? ""
        : iso_to_local_input(key.expires_at),
    });
  }

  async function save_edit(key: ApiKeyPanelKey): Promise<void> {
    const candidate = to_draft(edit_draft);
    const violation = api_key_draft_violation(candidate, new Date());
    if (violation !== null) {
      set_notice({ kind: "error", message: violation });
      return;
    }
    set_busy(true);
    set_notice({ kind: "none" });
    const result = await send(
      prepare_api_key_update_request(props.csrf_token, key, candidate),
    );
    set_busy(false);
    if (!result.ok) return;
    const updated = result.status === 200
      ? panel_key_from_api((result.body as { api_key?: unknown })?.api_key)
      : null;
    if (updated === null) {
      await handle_failure(result.status, result.body);
      return;
    }
    set_keys((current) =>
      current.map((entry) =>
        entry.api_key_id === updated.api_key_id ? updated : entry
      )
    );
    set_editing(null);
  }

  async function revoke(key: ApiKeyPanelKey): Promise<void> {
    if (confirm_revoke !== key.api_key_id) {
      set_confirm_revoke(key.api_key_id);
      return;
    }
    set_busy(true);
    set_notice({ kind: "none" });
    const result = await send(
      prepare_api_key_revoke_request(props.csrf_token, key),
    );
    set_busy(false);
    set_confirm_revoke(null);
    if (!result.ok) return;
    if (result.status !== 200) {
      await handle_failure(result.status, result.body);
      return;
    }
    set_keys((current) =>
      current.filter((entry) => entry.api_key_id !== key.api_key_id)
    );
    if (generated?.api_key_id === key.api_key_id) set_generated(null);
    set_notice({ kind: "info", message: `Revoked “${key.label}”.` });
  }

  async function revoke_all(): Promise<void> {
    if (!confirm_revoke_all) {
      set_confirm_revoke_all(true);
      return;
    }
    set_busy(true);
    set_notice({ kind: "none" });
    const result = await send(
      prepare_api_key_revoke_all_request(props.csrf_token),
    );
    set_busy(false);
    set_confirm_revoke_all(false);
    if (!result.ok) return;
    const revoked = result.status === 200
      ? revoked_count_from_api(result.body)
      : null;
    if (revoked === null) {
      await handle_failure(result.status, result.body);
      return;
    }
    set_keys([]);
    set_generated(null);
    set_notice({
      kind: "info",
      message: revoked === 1
        ? "Revoked 1 API key."
        : `Revoked ${revoked} API keys.`,
    });
  }

  function draft_form(
    state: DraftState,
    set_state: (updater: (current: DraftState) => DraftState) => void,
    id_prefix: string,
  ) {
    return (
      <>
        <label for={`${id_prefix}-label`}>Label</label>
        <input
          id={`${id_prefix}-label`}
          value={state.label}
          maxlength={64}
          autocomplete="off"
          placeholder="ci deployment"
          onInput={(event) => {
            const label = event.currentTarget.value;
            set_state((current) => ({ ...current, label }));
          }}
        />
        <fieldset class="api-key-permissions">
          <legend>Permissions</legend>
          <label class="api-key-permission-choice">
            <input
              type="checkbox"
              checked={state.all_access}
              onInput={(event) => {
                const all_access = event.currentTarget.checked;
                set_state((current) => ({
                  ...current,
                  all_access,
                  permissions: all_access
                    ? [...api_key_permission_choices]
                    : current.permissions,
                }));
              }}
            />
            Full access (everything the API allows now and nothing more)
          </label>
          {api_key_permission_choices.map((permission) => (
            <label key={permission} class="api-key-permission-choice">
              <input
                type="checkbox"
                disabled={state.all_access}
                checked={state.all_access ||
                  state.permissions.includes(permission)}
                onInput={(event) => {
                  const checked = event.currentTarget.checked;
                  set_state((current) => ({
                    ...current,
                    permissions: checked
                      ? [...current.permissions, permission]
                      : current.permissions.filter(
                        (entry) =>
                          entry !== permission,
                      ),
                  }));
                }}
              />
              {permission}
            </label>
          ))}
        </fieldset>
        <label for={`${id_prefix}-expiry`}>
          Expires (leave empty for a key that never expires)
        </label>
        <input
          id={`${id_prefix}-expiry`}
          type="datetime-local"
          value={state.expires_at_local}
          onInput={(event) => {
            const expires_at_local = event.currentTarget.value;
            set_state((current) => ({ ...current, expires_at_local }));
          }}
        />
      </>
    );
  }

  return (
    <section class="api-key-panel" aria-labelledby="api-keys-heading">
      <div class="section-heading">
        <p class="eyebrow">Automation</p>
        <h2 id="api-keys-heading">API keys</h2>
        <p>
          API keys let scripts call the owner API with{" "}
          <code>Authorization: Bearer …</code>. A key acts with your authority
          within its permissions; it never signs in to the site.
        </p>
      </div>

      {generated !== null && (
        <div class="api-key-generated" role="alert">
          <h3>Key “{generated.label}” generated</h3>
          <p>
            <strong>Copy it now.</strong>{" "}
            This is the only time the key is shown; it cannot be recovered
            later, only replaced.
          </p>
          <div class="api-key-generated-row">
            <code class="api-key-bearer">{generated.bearer}</code>
            <button
              type="button"
              onClick={() => copy_bearer(generated.bearer)}
            >
              {copied ? "Copied" : "Copy key"}
            </button>
            <button
              type="button"
              class="api-key-dismiss"
              onClick={() => set_generated(null)}
            >
              I stored it
            </button>
          </div>
        </div>
      )}

      {keys.length === 0
        ? <p class="api-key-empty">No API keys yet. Generate one below.</p>
        : (
          <ul class="api-key-list">
            {keys.map((key) => (
              <li key={key.api_key_id} class="api-key-item">
                <div class="api-key-item-summary">
                  <strong class="api-key-label">{key.label}</strong>
                  <span class="api-key-permissions-badge">
                    {key.permissions.join(", ")}
                  </span>
                  <span class={`api-key-status api-key-status-${key.status}`}>
                    {key.status}
                  </span>
                  <span class="api-key-expiry">
                    {key.expires_at === null
                      ? "never expires"
                      : `expires ${key.expires_at.slice(0, 10)}`}
                  </span>
                  <span class="api-key-created">
                    created {key.created_at.slice(0, 10)}
                  </span>
                </div>
                {editing === key.api_key_id
                  ? (
                    <div class="api-key-edit-form">
                      {draft_form(
                        edit_draft,
                        (updater) => set_edit_draft(updater),
                        `edit-${key.api_key_id}`,
                      )}
                      <div class="api-key-item-actions">
                        <button
                          type="button"
                          disabled={busy}
                          onClick={() => save_edit(key)}
                        >
                          Save changes
                        </button>
                        <button
                          type="button"
                          onClick={() => set_editing(null)}
                        >
                          Cancel
                        </button>
                      </div>
                    </div>
                  )
                  : (
                    <div class="api-key-item-actions">
                      <button
                        type="button"
                        disabled={busy}
                        onClick={() => start_edit(key)}
                      >
                        Edit
                      </button>
                      <button
                        type="button"
                        class="api-key-revoke"
                        disabled={busy}
                        onClick={() => revoke(key)}
                      >
                        {confirm_revoke === key.api_key_id
                          ? "Confirm revoke"
                          : "Revoke"}
                      </button>
                    </div>
                  )}
              </li>
            ))}
          </ul>
        )}

      <form class="api-key-form" onSubmit={generate}>
        <h3>Generate a new key</h3>
        {draft_form(draft, (updater) => set_draft(updater), "new-key")}
        <button type="submit" disabled={busy}>
          {busy ? "Working…" : "Generate key"}
        </button>
      </form>

      {keys.length > 0 && (
        <div class="api-key-danger">
          <h3>Revoke everything</h3>
          <p>
            Immediately invalidates every API key you own. Running automation
            stops until new keys are issued.
          </p>
          <button
            type="button"
            class="api-key-revoke-all"
            disabled={busy}
            onClick={revoke_all}
          >
            {confirm_revoke_all
              ? `Confirm: revoke all ${keys.length} keys`
              : "Revoke all keys"}
          </button>
          {confirm_revoke_all && (
            <button
              type="button"
              onClick={() => set_confirm_revoke_all(false)}
            >
              Keep my keys
            </button>
          )}
        </div>
      )}

      <div class="api-key-result" aria-live="polite">
        {notice.kind === "error" && (
          <p class="error-message">{notice.message}</p>
        )}
        {notice.kind === "info" && <p>{notice.message}</p>}
      </div>
    </section>
  );
}

/** `datetime-local` values carry no zone; interpret them as local time. */
function local_input_to_iso(value: string): string | null {
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function iso_to_local_input(iso: string): string {
  const parsed = new Date(iso);
  if (Number.isNaN(parsed.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${
    pad(parsed.getDate())
  }T${pad(parsed.getHours())}:${pad(parsed.getMinutes())}`;
}

import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { PageEditor } from "../components/PageEditor.tsx";
import {
  format_size_bytes,
  managed_md_page_draft,
  management_summary_from_api,
  type PageManagementSummary,
  prepare_managed_delete_request,
  prepare_managed_inspect_request,
  prepare_managed_list_request,
  prepare_managed_update_request,
} from "../lib/ui/page-management.ts";
import { ClientPagePreviewer } from "../lib/ui/page-preview.ts";

type PanelNotice =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface EditorState {
  page_id: string;
  markdown: string;
  css: string;
  saving: boolean;
}

export interface PageManagementPanelProps {
  /** Synchronizer token minted server-side for the authenticated session. */
  csrf_token: string;
  /** Server-rendered snapshot; the island continues through `/api/pages`. */
  initial_pages: readonly PageManagementSummary[];
  initial_next_cursor: string | null;
}

/**
 * Creator management panel (DS-PROTECT): lists managed pages and projects
 * inspect, content editing, access changes, and deletion onto the existing
 * revision-bound `/api/pages` contracts. No management rule lives here.
 */
export default function PageManagementPanel(props: PageManagementPanelProps) {
  const page_previewer = useMemo(() => new ClientPagePreviewer(), []);
  const [pages, set_pages] = useState(props.initial_pages);
  const [next_cursor, set_next_cursor] = useState(props.initial_next_cursor);
  const [loading_more, set_loading_more] = useState(false);
  const [notice, set_notice] = useState<PanelNotice | null>(null);
  const [busy_page, set_busy_page] = useState<string | null>(null);
  const [confirming_delete, set_confirming_delete] = useState<string | null>(
    null,
  );
  const [editor, set_editor] = useState<EditorState | null>(null);

  function replace_row(page_id: string, next: PageManagementSummary) {
    set_pages((current) =>
      current.map((page) => page.page_id === page_id ? next : page)
    );
  }

  function drop_row(page_id: string) {
    set_pages((current) => current.filter((page) => page.page_id !== page_id));
    if (editor?.page_id === page_id) set_editor(null);
    if (confirming_delete === page_id) set_confirming_delete(null);
  }

  function fail(message: string) {
    set_notice({ kind: "error", message });
  }

  async function read_error(response: Response): Promise<string> {
    try {
      const body = await response.json();
      if (typeof body?.detail === "string" && body.detail !== "") {
        return body.detail;
      }
    } catch {
      // fall through to the status-based message
    }
    return `request failed (${response.status})`;
  }

  /** Re-reads one row after a conflict so the next attempt is current. */
  async function refresh_row(page: PageManagementSummary) {
    const request = prepare_managed_inspect_request(page.management_url);
    const response = await fetch(request.url, { method: request.method });
    if (response.status === 404) {
      drop_row(page.page_id);
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    const refreshed = management_summary_from_api(body?.page);
    if (refreshed !== null) replace_row(page.page_id, refreshed);
  }

  async function load_more() {
    if (next_cursor === null || loading_more) return;
    set_loading_more(true);
    set_notice(null);
    try {
      const request = prepare_managed_list_request({ cursor: next_cursor });
      const response = await fetch(request.url, { method: request.method });
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const body = await response.json();
      const rows = Array.isArray(body?.pages)
        ? body.pages.map(management_summary_from_api)
        : null;
      if (rows === null || rows.some((row: unknown) => row === null)) {
        fail("page list response was not understood");
        return;
      }
      set_pages((current) => [...current, ...rows]);
      set_next_cursor(
        typeof body.next_cursor === "string" ? body.next_cursor : null,
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_loading_more(false);
    }
  }

  async function toggle_access(page: PageManagementSummary) {
    set_busy_page(page.page_id);
    set_notice(null);
    const access = page.access === "public" ? "private" : "public";
    try {
      const request = prepare_managed_update_request(
        page,
        { access },
        props.csrf_token,
      );
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      if (response.status === 412) {
        fail(`${page.path} changed elsewhere; the row was refreshed.`);
        await refresh_row(page);
        return;
      }
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const body = await response.json();
      const updated = management_summary_from_api(body?.page);
      if (updated === null) {
        fail("update response was not understood");
        return;
      }
      replace_row(page.page_id, updated);
      set_notice({
        kind: "success",
        message: `${updated.path} is now ${updated.access}.`,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
    }
  }

  async function open_editor(page: PageManagementSummary) {
    set_busy_page(page.page_id);
    set_notice(null);
    try {
      const request = prepare_managed_inspect_request(page.management_url);
      const response = await fetch(request.url, { method: request.method });
      if (!response.ok) {
        fail(await read_error(response));
        if (response.status === 404) drop_row(page.page_id);
        return;
      }
      const body = await response.json();
      const refreshed = management_summary_from_api(body?.page);
      const draft = managed_md_page_draft(body?.page?.content);
      if (refreshed === null || draft === null) {
        fail(`${page.path} cannot be edited here (${page.content_type}).`);
        return;
      }
      replace_row(page.page_id, refreshed);
      set_confirming_delete(null);
      set_editor({
        page_id: page.page_id,
        markdown: draft.markdown,
        css: draft.css,
        saving: false,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
    }
  }

  async function save_editor(page: PageManagementSummary) {
    if (editor === null || editor.saving) return;
    set_editor({ ...editor, saving: true });
    set_notice(null);
    try {
      const request = prepare_managed_update_request(
        page,
        { content: { markdown: editor.markdown, css: editor.css } },
        props.csrf_token,
      );
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
        body: JSON.stringify(request.body),
      });
      if (response.status === 412) {
        fail(
          `${page.path} changed elsewhere; review the refreshed row and save again.`,
        );
        await refresh_row(page);
        set_editor((current) =>
          current === null ? null : { ...current, saving: false }
        );
        return;
      }
      if (!response.ok) {
        fail(await read_error(response));
        set_editor((current) =>
          current === null ? null : { ...current, saving: false }
        );
        return;
      }
      const body = await response.json();
      const updated = management_summary_from_api(body?.page);
      if (updated !== null) replace_row(page.page_id, updated);
      set_editor(null);
      set_notice({ kind: "success", message: `${page.path} was updated.` });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      set_editor((current) =>
        current === null ? null : { ...current, saving: false }
      );
    }
  }

  async function remove(page: PageManagementSummary) {
    if (confirming_delete !== page.page_id) {
      set_confirming_delete(page.page_id);
      return;
    }
    set_busy_page(page.page_id);
    set_notice(null);
    try {
      const request = prepare_managed_delete_request(page, props.csrf_token);
      const response = await fetch(request.url, {
        method: request.method,
        headers: request.headers,
      });
      if (response.status === 412) {
        fail(`${page.path} changed elsewhere; the row was refreshed.`);
        set_confirming_delete(null);
        await refresh_row(page);
        return;
      }
      if (response.status === 404) {
        drop_row(page.page_id);
        set_notice({ kind: "success", message: `${page.path} is gone.` });
        return;
      }
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      drop_row(page.page_id);
      set_notice({ kind: "success", message: `${page.path} was deleted.` });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
    }
  }

  return (
    <section
      class="page-management-panel"
      aria-labelledby="page-management-heading"
    >
      <div class="section-heading">
        <p class="eyebrow">Your pages</p>
        <h2 id="page-management-heading">Managed pages</h2>
        <p>
          Pages in your reserved namespaces. Edit content, switch public and
          private, or delete; direct links always serve the current committed
          page.
        </p>
      </div>

      {pages.length === 0
        ? (
          <p class="page-management-empty">
            No managed pages yet. Publish into a reserved namespace and it
            appears here.
          </p>
        )
        : (
          <ul class="page-management-list">
            {pages.map((page) => (
              <li key={page.page_id} class="page-management-item">
                <div class="page-management-row">
                  <a class="page-management-path" href={page.path}>
                    {page.path}
                  </a>
                  <span
                    class={`page-management-access page-management-access-${page.access}`}
                  >
                    {page.access}
                  </span>
                  <span class="page-management-meta">
                    {page.content_type} · {format_size_bytes(page.size_bytes)}
                    {" "}
                    · updated {page.updated_at.slice(0, 10)}
                  </span>
                  <div class="page-management-actions">
                    <button
                      type="button"
                      disabled={busy_page !== null}
                      onClick={() =>
                        editor?.page_id === page.page_id
                          ? set_editor(null)
                          : open_editor(page)}
                    >
                      {editor?.page_id === page.page_id ? "Close" : "Edit"}
                    </button>
                    <button
                      type="button"
                      disabled={busy_page !== null}
                      onClick={() =>
                        toggle_access(page)}
                    >
                      Make {page.access === "public" ? "private" : "public"}
                    </button>
                    {confirming_delete === page.page_id
                      ? (
                        <>
                          <button
                            type="button"
                            class="page-management-danger"
                            disabled={busy_page !== null}
                            onClick={() => remove(page)}
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={busy_page !== null}
                            onClick={() => set_confirming_delete(null)}
                          >
                            Keep
                          </button>
                        </>
                      )
                      : (
                        <button
                          type="button"
                          class="page-management-danger"
                          disabled={busy_page !== null}
                          onClick={() => remove(page)}
                        >
                          Delete
                        </button>
                      )}
                  </div>
                </div>

                {editor?.page_id === page.page_id && (
                  <form
                    class="page-management-editor"
                    onSubmit={(
                      event: JSX.TargetedSubmitEvent<HTMLFormElement>,
                    ) => {
                      event.preventDefault();
                      save_editor(page);
                    }}
                  >
                    <PageEditor
                      markdown={editor.markdown}
                      css={editor.css}
                      on_markdown_input={(value) =>
                        set_editor((current) =>
                          current === null
                            ? null
                            : { ...current, markdown: value }
                        )}
                      on_css_input={(value) =>
                        set_editor((current) =>
                          current === null ? null : { ...current, css: value }
                        )}
                      previewer={page_previewer}
                    />
                    <div class="page-management-editor-actions">
                      <button type="submit" disabled={editor.saving}>
                        {editor.saving ? "Saving…" : "Save changes"}
                      </button>
                      <button
                        type="button"
                        disabled={editor.saving}
                        onClick={() => set_editor(null)}
                      >
                        Cancel
                      </button>
                    </div>
                  </form>
                )}
              </li>
            ))}
          </ul>
        )}

      {next_cursor !== null && (
        <button
          type="button"
          class="page-management-more"
          disabled={loading_more}
          onClick={load_more}
        >
          {loading_more ? "Loading…" : "Load more pages"}
        </button>
      )}

      <div class="page-management-result" aria-live="polite">
        {notice !== null && (
          <p class={notice.kind === "error" ? "error-message" : ""}>
            {notice.message}
          </p>
        )}
      </div>
    </section>
  );
}

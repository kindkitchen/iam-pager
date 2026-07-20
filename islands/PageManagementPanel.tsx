import type { JSX } from "preact";
import { useMemo, useState } from "preact/hooks";
import { PageEditor } from "../components/PageEditor.tsx";
import { PdfFileSelection } from "../components/PdfFileSelection.tsx";
import {
  format_size_bytes,
  managed_bulk_access_from_api,
  managed_bulk_delete_from_api,
  managed_list_from_api,
  managed_md_page_draft,
  managed_pdf_delivery_links,
  managed_pdf_metadata,
  managed_pdf_replacement_violation,
  managed_revision_selection,
  managed_tags_from_input,
  type ManagedPageFilters,
  type ManagedPdfMetadata,
  management_summary_from_api,
  management_summary_matches_filters,
  type PageManagementSummary,
  prepare_managed_bulk_access_request,
  prepare_managed_bulk_delete_request,
  prepare_managed_delete_request,
  prepare_managed_duplicate_request,
  prepare_managed_inspect_request,
  prepare_managed_list_request,
  prepare_managed_pdf_replace_request,
  prepare_managed_rename_request,
  prepare_managed_update_request,
  type PreparedManagedRequest,
} from "../lib/ui/page-management.ts";
import { page_api_failure_presenter } from "../lib/ui/page-api-failure.ts";
import { ClientPagePreviewer } from "../lib/ui/page-preview.ts";
import {
  describe_pdf_file,
  pdf_file_selection_presenter,
} from "../lib/ui/pdf-file-selection.ts";

type PanelNotice =
  | { kind: "success"; message: string }
  | { kind: "error"; message: string };

interface MdEditorState {
  kind: "md-page";
  page_id: string;
  markdown: string;
  css: string;
  tags_input: string;
  saving: boolean;
}

interface PdfEditorState {
  kind: "pdf";
  page_id: string;
  metadata: ManagedPdfMetadata;
  selected_file: File | null;
  tags_input: string;
  saving: boolean;
}

type EditorState = MdEditorState | PdfEditorState;

interface RenameState {
  page_id: string;
  page_name: string;
}

interface BulkResultState {
  page_id: string;
  path: string;
  outcome: string;
  ok: boolean;
}

interface FilterDraft {
  name: string;
  access: "" | "public" | "private";
  tag: string;
}

const empty_filter_draft: FilterDraft = { name: "", access: "", tag: "" };
const max_ui_selection = 100;

export interface PageManagementPanelProps {
  /** Synchronizer token minted server-side for the authenticated session. */
  csrf_token: string;
  /** Server-rendered snapshot; the island continues through `/api/pages`. */
  initial_pages: readonly PageManagementSummary[];
  initial_next_cursor: string | null;
}

/**
 * Creator management panel (DS-MANAGE): projects filtering, tag/content edits,
 * rename, duplicate, explicit selection, bulk access, and bulk deletion onto
 * the strict revision-bound API. All management rules remain outside the UI.
 */
export default function PageManagementPanel(props: PageManagementPanelProps) {
  const page_previewer = useMemo(() => new ClientPagePreviewer(), []);
  const [pages, set_pages] = useState(props.initial_pages);
  const [next_cursor, set_next_cursor] = useState(props.initial_next_cursor);
  const [filter_draft, set_filter_draft] = useState<FilterDraft>(
    empty_filter_draft,
  );
  const [applied_filters, set_applied_filters] = useState<ManagedPageFilters>(
    {},
  );
  const [filtering, set_filtering] = useState(false);
  const [loading_more, set_loading_more] = useState(false);
  const [notice, set_notice] = useState<PanelNotice | null>(null);
  const [busy_page, set_busy_page] = useState<string | null>(null);
  const [bulk_busy, set_bulk_busy] = useState(false);
  const [bulk_results, set_bulk_results] = useState<
    readonly BulkResultState[]
  >([]);
  const [bulk_access, set_bulk_access] = useState<"public" | "private">(
    "public",
  );
  const [selected_page_ids, set_selected_page_ids] = useState<Set<string>>(
    new Set(),
  );
  const [confirming_bulk_delete, set_confirming_bulk_delete] = useState(false);
  const [confirming_delete, set_confirming_delete] = useState<string | null>(
    null,
  );
  const [rename, set_rename] = useState<RenameState | null>(null);
  const [editor, set_editor] = useState<EditorState | null>(null);
  const selected_pdf_replacement = editor?.kind === "pdf"
    ? editor.selected_file
    : null;
  const pdf_replacement_file_view = useMemo(
    () =>
      selected_pdf_replacement === null
        ? pdf_file_selection_presenter.present(null)
        : pdf_file_selection_presenter.present(
          describe_pdf_file(selected_pdf_replacement),
        ),
    [selected_pdf_replacement],
  );

  const controls_busy = filtering || bulk_busy || busy_page !== null;
  const has_applied_filters = Object.keys(applied_filters).length > 0;

  function replace_row(page_id: string, next: PageManagementSummary) {
    set_pages((current) =>
      current.map((page) => page.page_id === page_id ? next : page)
    );
  }

  function update_filtered_row(
    page_id: string,
    next: PageManagementSummary,
  ) {
    if (management_summary_matches_filters(next, applied_filters)) {
      replace_row(page_id, next);
    } else {
      drop_row(page_id);
    }
  }

  function insert_after(
    source_page_id: string,
    next: PageManagementSummary,
  ) {
    if (!management_summary_matches_filters(next, applied_filters)) return;
    set_pages((current) => {
      if (current.some((page) => page.page_id === next.page_id)) return current;
      const source_index = current.findIndex((page) =>
        page.page_id === source_page_id
      );
      if (source_index < 0) return [...current, next];
      return [
        ...current.slice(0, source_index + 1),
        next,
        ...current.slice(source_index + 1),
      ];
    });
  }

  function drop_row(page_id: string) {
    set_pages((current) => current.filter((page) => page.page_id !== page_id));
    set_selected_page_ids((current) => {
      if (!current.has(page_id)) return current;
      const next = new Set(current);
      next.delete(page_id);
      return next;
    });
    set_editor((current) => current?.page_id === page_id ? null : current);
    set_rename((current) => current?.page_id === page_id ? null : current);
    set_confirming_delete((current) => current === page_id ? null : current);
  }

  function fail(message: string) {
    set_notice({ kind: "error", message });
  }

  async function read_error(
    response: Response,
    content_type?: string,
  ): Promise<string> {
    let body: unknown = null;
    try {
      body = await response.json();
    } catch {
      // The typed fallback intentionally ignores non-JSON response text.
    }
    return page_api_failure_presenter.present(
      response.status,
      body,
      { operation: "manage", content_type },
    ).message;
  }

  async function send(request: PreparedManagedRequest): Promise<Response> {
    return await fetch(request.url, {
      method: request.method,
      headers: request.headers,
      ...(request.body === undefined ? {} : {
        body: request.body instanceof FormData
          ? request.body
          : JSON.stringify(request.body),
      }),
    });
  }

  /** Re-reads one row after a conflict so the next attempt is current. */
  async function refresh_row(page: PageManagementSummary) {
    const request = prepare_managed_inspect_request(page.management_url);
    const response = await send(request);
    if (response.status === 404) {
      drop_row(page.page_id);
      return;
    }
    if (!response.ok) return;
    const body = await response.json();
    const refreshed = management_summary_from_api(body?.page);
    if (refreshed !== null) {
      update_filtered_row(page.page_id, refreshed);
      const pdf_metadata = managed_pdf_metadata(
        body?.page?.content,
        refreshed.size_bytes,
      );
      if (pdf_metadata !== null) {
        set_editor((current) =>
          current?.kind === "pdf" && current.page_id === page.page_id
            ? { ...current, metadata: pdf_metadata }
            : current
        );
      }
    }
  }

  async function replace_list(filters: ManagedPageFilters) {
    set_filtering(true);
    set_notice(null);
    try {
      const response = await send(prepare_managed_list_request({ filters }));
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const result = managed_list_from_api(await response.json());
      if (result === null) {
        fail("page list response was not understood");
        return;
      }
      set_pages(result.pages);
      set_next_cursor(result.next_cursor);
      set_applied_filters(filters);
      set_selected_page_ids(new Set());
      set_bulk_results([]);
      set_confirming_bulk_delete(false);
      set_confirming_delete(null);
      set_rename(null);
      set_editor(null);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_filtering(false);
    }
  }

  async function apply_filters(
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const filters: ManagedPageFilters = {
      ...(filter_draft.name.trim() === "" ? {} : { name: filter_draft.name }),
      ...(filter_draft.access === "" ? {} : { access: filter_draft.access }),
      ...(filter_draft.tag.trim() === "" ? {} : { tag: filter_draft.tag }),
    };
    await replace_list(filters);
  }

  async function clear_filters() {
    set_filter_draft(empty_filter_draft);
    await replace_list({});
  }

  async function load_more() {
    if (next_cursor === null || loading_more) return;
    set_loading_more(true);
    set_notice(null);
    try {
      const request = prepare_managed_list_request({
        cursor: next_cursor,
        filters: applied_filters,
      });
      const response = await send(request);
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const result = managed_list_from_api(await response.json());
      if (result === null) {
        fail("page list response was not understood");
        return;
      }
      set_pages((current) => {
        const existing_ids = new Set(current.map((page) => page.page_id));
        return [
          ...current,
          ...result.pages.filter((page) => !existing_ids.has(page.page_id)),
        ];
      });
      set_next_cursor(result.next_cursor);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_loading_more(false);
    }
  }

  function toggle_selection(page_id: string) {
    set_confirming_bulk_delete(false);
    set_bulk_results([]);
    if (
      !selected_page_ids.has(page_id) &&
      selected_page_ids.size >= max_ui_selection
    ) {
      fail(`Select at most ${max_ui_selection} pages per bulk action.`);
      return;
    }
    set_selected_page_ids((current) => {
      const next = new Set(current);
      if (next.has(page_id)) next.delete(page_id);
      else next.add(page_id);
      return next;
    });
  }

  function toggle_visible_selection() {
    set_confirming_bulk_delete(false);
    set_bulk_results([]);
    const all_visible_selected = pages.length > 0 &&
      pages.every((page) => selected_page_ids.has(page.page_id));
    if (all_visible_selected) {
      set_selected_page_ids((current) => {
        const next = new Set(current);
        for (const page of pages) next.delete(page.page_id);
        return next;
      });
      return;
    }
    const next = new Set(selected_page_ids);
    for (const page of pages) next.add(page.page_id);
    if (next.size > max_ui_selection) {
      fail(`Select at most ${max_ui_selection} pages per bulk action.`);
      return;
    }
    set_selected_page_ids(next);
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
      const response = await send(request);
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
      update_filtered_row(page.page_id, updated);
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
      const response = await send(
        prepare_managed_inspect_request(page.management_url),
      );
      if (!response.ok) {
        fail(await read_error(response));
        if (response.status === 404) drop_row(page.page_id);
        return;
      }
      const body = await response.json();
      const refreshed = management_summary_from_api(body?.page);
      if (refreshed === null) {
        fail("page inspection response was not understood");
        return;
      }
      const md_draft = managed_md_page_draft(body?.page?.content);
      const pdf_metadata = managed_pdf_metadata(
        body?.page?.content,
        refreshed.size_bytes,
      );
      if (md_draft === null && pdf_metadata === null) {
        fail(`${page.path} cannot be edited here (${page.content_type}).`);
        return;
      }
      update_filtered_row(page.page_id, refreshed);
      set_confirming_delete(null);
      set_rename(null);
      set_editor(
        md_draft !== null
          ? {
            kind: "md-page",
            page_id: page.page_id,
            markdown: md_draft.markdown,
            css: md_draft.css,
            tags_input: refreshed.tags.join(", "),
            saving: false,
          }
          : {
            kind: "pdf",
            page_id: page.page_id,
            metadata: pdf_metadata!,
            selected_file: null,
            tags_input: refreshed.tags.join(", "),
            saving: false,
          },
      );
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
    }
  }

  async function save_md_editor(page: PageManagementSummary) {
    if (editor?.kind !== "md-page" || editor.saving) return;
    set_editor({ ...editor, saving: true });
    set_notice(null);
    try {
      const request = prepare_managed_update_request(
        page,
        {
          tags: managed_tags_from_input(editor.tags_input),
          content: { markdown: editor.markdown, css: editor.css },
        },
        props.csrf_token,
      );
      const response = await send(request);
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
      if (updated === null) {
        fail("update response was not understood");
        set_editor((current) =>
          current === null ? null : { ...current, saving: false }
        );
        return;
      }
      update_filtered_row(page.page_id, updated);
      set_editor(null);
      set_notice({ kind: "success", message: `${updated.path} was updated.` });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      set_editor((current) =>
        current === null ? null : { ...current, saving: false }
      );
    }
  }

  async function save_pdf_editor(page: PageManagementSummary) {
    if (editor?.kind !== "pdf" || editor.saving) return;
    const selected_file = editor.selected_file;
    if (selected_file === null) {
      fail("Select a PDF replacement file.");
      return;
    }
    const current_editor = editor;
    set_editor({ ...current_editor, saving: true });
    set_notice(null);
    try {
      const bytes = new Uint8Array(await selected_file.arrayBuffer());
      const draft = {
        filename: selected_file.name,
        bytes,
        tags: managed_tags_from_input(current_editor.tags_input),
      };
      const violation = managed_pdf_replacement_violation(draft);
      if (violation !== null) {
        fail(violation);
        set_editor((current) =>
          current?.kind === "pdf" ? { ...current, saving: false } : current
        );
        return;
      }
      const response = await send(
        prepare_managed_pdf_replace_request(page, draft, props.csrf_token),
      );
      if (response.status === 412) {
        fail(
          `${page.path} changed elsewhere; review the refreshed metadata and replace again.`,
        );
        await refresh_row(page);
        set_editor((current) =>
          current?.kind === "pdf" ? { ...current, saving: false } : current
        );
        return;
      }
      if (!response.ok) {
        fail(await read_error(response, "pdf"));
        set_editor((current) =>
          current?.kind === "pdf" ? { ...current, saving: false } : current
        );
        return;
      }
      const body = await response.json();
      const updated = management_summary_from_api(body?.page);
      const metadata = managed_pdf_metadata(
        body?.page?.content,
        updated?.size_bytes,
      );
      if (updated === null || metadata === null) {
        fail("PDF replacement response was not understood");
        set_editor((current) =>
          current?.kind === "pdf" ? { ...current, saving: false } : current
        );
        return;
      }
      update_filtered_row(page.page_id, updated);
      set_editor(null);
      set_notice({
        kind: "success",
        message: `${updated.path} now serves ${metadata.filename}.`,
      });
    } catch {
      fail(
        "The PDF replacement could not be sent. Keep the file and try again.",
      );
      set_editor((current) =>
        current?.kind === "pdf" ? { ...current, saving: false } : current
      );
    }
  }

  async function rename_page(page: PageManagementSummary) {
    if (rename === null || rename.page_id !== page.page_id) return;
    set_busy_page(page.page_id);
    set_notice(null);
    try {
      const page_name = rename.page_name.trim();
      const request = prepare_managed_rename_request(
        page,
        page_name === "" ? undefined : page_name,
        props.csrf_token,
      );
      const response = await send(request);
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
        fail("rename response was not understood");
        return;
      }
      update_filtered_row(page.page_id, updated);
      set_rename(null);
      set_notice({
        kind: "success",
        message: `${page.path} was renamed to ${updated.path}.`,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
    }
  }

  async function duplicate_page(page: PageManagementSummary) {
    set_busy_page(page.page_id);
    set_notice(null);
    try {
      const response = await send(
        prepare_managed_duplicate_request(page, props.csrf_token),
      );
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
      const duplicated = management_summary_from_api(body?.page);
      if (duplicated === null) {
        fail("duplicate response was not understood");
        return;
      }
      insert_after(page.page_id, duplicated);
      set_notice({
        kind: "success",
        message: management_summary_matches_filters(
            duplicated,
            applied_filters,
          )
          ? `${duplicated.path} was created.`
          : `${duplicated.path} was created but does not match the filters.`,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_busy_page(null);
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
      const response = await send(
        prepare_managed_delete_request(page, props.csrf_token),
      );
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

  function current_bulk_selection() {
    try {
      return managed_revision_selection(pages, selected_page_ids);
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
      return null;
    }
  }

  async function change_selected_access() {
    const selection = current_bulk_selection();
    if (selection === null) return;
    set_bulk_busy(true);
    set_notice(null);
    try {
      const response = await send(
        prepare_managed_bulk_access_request(
          selection,
          bulk_access,
          props.csrf_token,
        ),
      );
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const results = managed_bulk_access_from_api(await response.json());
      if (
        results === null || results.length !== selection.length ||
        results.some((item, index) =>
          item.page_id !== selection[index]?.page_id
        )
      ) {
        fail("bulk access response was not understood");
        return;
      }
      set_bulk_results(results.map((item) => {
        const previous = pages.find((page) => page.page_id === item.page_id);
        return {
          page_id: item.page_id,
          path: item.ok ? item.page.path : previous?.path ?? item.page_id,
          outcome: item.ok
            ? `access changed to ${item.page.access}`
            : bulk_error_label(item.error),
          ok: item.ok,
        };
      }));
      let changed = 0;
      let failed = 0;
      for (const item of results) {
        if (item.ok) {
          changed++;
          update_filtered_row(item.page_id, item.page);
          continue;
        }
        failed++;
        const stale_page = pages.find((page) => page.page_id === item.page_id);
        if (item.error === "not_found") drop_row(item.page_id);
        else if (
          item.error === "revision_conflict" && stale_page !== undefined
        ) {
          await refresh_row(stale_page);
        }
      }
      set_selected_page_ids(new Set());
      set_notice({
        kind: failed === 0 ? "success" : "error",
        message: failed === 0
          ? `Changed access for ${changed} ${page_word(changed)}.`
          : `Changed ${changed}; ${failed} ${
            page_word(failed)
          } could not be changed.`,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_bulk_busy(false);
    }
  }

  async function delete_selected() {
    if (!confirming_bulk_delete) {
      if (selected_page_ids.size === 0) {
        fail("Select at least one page for bulk deletion.");
        return;
      }
      set_confirming_bulk_delete(true);
      return;
    }
    const selection = current_bulk_selection();
    if (selection === null) return;
    set_bulk_busy(true);
    set_notice(null);
    try {
      const response = await send(
        prepare_managed_bulk_delete_request(selection, props.csrf_token),
      );
      if (!response.ok) {
        fail(await read_error(response));
        return;
      }
      const results = managed_bulk_delete_from_api(await response.json());
      if (
        results === null || results.length !== selection.length ||
        results.some((item, index) =>
          item.page_id !== selection[index]?.page_id
        )
      ) {
        fail("bulk delete response was not understood");
        return;
      }
      set_bulk_results(results.map((item) => {
        const previous = pages.find((page) => page.page_id === item.page_id);
        return {
          page_id: item.page_id,
          path: previous?.path ?? item.page_id,
          outcome: item.ok ? "deleted" : bulk_error_label(item.error),
          ok: item.ok,
        };
      }));
      let deleted = 0;
      let failed = 0;
      for (const item of results) {
        if (item.ok || item.error === "not_found") {
          if (item.ok) deleted++;
          drop_row(item.page_id);
          continue;
        }
        failed++;
        const stale_page = pages.find((page) => page.page_id === item.page_id);
        if (stale_page !== undefined) await refresh_row(stale_page);
      }
      set_selected_page_ids(new Set());
      set_confirming_bulk_delete(false);
      set_notice({
        kind: failed === 0 ? "success" : "error",
        message: failed === 0
          ? `Deleted ${deleted} ${page_word(deleted)}.`
          : `Deleted ${deleted}; ${failed} ${
            page_word(failed)
          } changed elsewhere.`,
      });
    } catch (error) {
      fail(error instanceof Error ? error.message : String(error));
    } finally {
      set_bulk_busy(false);
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
          Filter reserved-namespace pages, edit content and tags, rename or
          duplicate one page, or select up to 100 current revisions for bulk
          access and deletion.
        </p>
      </div>

      <form class="page-management-filters" onSubmit={apply_filters}>
        <label>
          Page name
          <input
            type="search"
            value={filter_draft.name}
            placeholder="contains…"
            onInput={(event) =>
              set_filter_draft({
                ...filter_draft,
                name: event.currentTarget.value,
              })}
          />
        </label>
        <label>
          Access
          <select
            value={filter_draft.access}
            onChange={(event) =>
              set_filter_draft({
                ...filter_draft,
                access: event.currentTarget.value as FilterDraft["access"],
              })}
          >
            <option value="">Any access</option>
            <option value="public">Public</option>
            <option value="private">Private</option>
          </select>
        </label>
        <label>
          Exact tag
          <input
            type="search"
            value={filter_draft.tag}
            placeholder="notes"
            onInput={(event) =>
              set_filter_draft({
                ...filter_draft,
                tag: event.currentTarget.value,
              })}
          />
        </label>
        <div class="page-management-filter-actions">
          <button type="submit" disabled={controls_busy}>
            {filtering ? "Filtering…" : "Apply filters"}
          </button>
          <button
            type="button"
            disabled={controls_busy ||
              (!has_applied_filters && filter_draft === empty_filter_draft)}
            onClick={clear_filters}
          >
            Clear
          </button>
        </div>
      </form>

      {pages.length > 0 && (
        <div class="page-management-bulk" aria-label="Bulk page actions">
          <button
            type="button"
            disabled={controls_busy}
            onClick={toggle_visible_selection}
          >
            {pages.every((page) =>
                selected_page_ids.has(page.page_id)
              )
              ? "Clear shown selection"
              : "Select shown"}
          </button>
          <strong>{selected_page_ids.size} selected</strong>
          <label>
            Set access
            <select
              value={bulk_access}
              disabled={controls_busy}
              onChange={(event) =>
                set_bulk_access(
                  event.currentTarget.value as "public" | "private",
                )}
            >
              <option value="public">Public</option>
              <option value="private">Private</option>
            </select>
          </label>
          <button
            type="button"
            disabled={controls_busy || selected_page_ids.size === 0}
            onClick={change_selected_access}
          >
            Apply access
          </button>
          {confirming_bulk_delete
            ? (
              <>
                <button
                  type="button"
                  class="page-management-danger"
                  disabled={controls_busy}
                  onClick={delete_selected}
                >
                  Confirm bulk delete
                </button>
                <button
                  type="button"
                  disabled={controls_busy}
                  onClick={() => set_confirming_bulk_delete(false)}
                >
                  Keep selected
                </button>
              </>
            )
            : (
              <button
                type="button"
                class="page-management-danger"
                disabled={controls_busy || selected_page_ids.size === 0}
                onClick={delete_selected}
              >
                Delete selected
              </button>
            )}
        </div>
      )}

      {pages.length === 0
        ? (
          <p class="page-management-empty">
            {has_applied_filters
              ? "No managed pages match these filters."
              : "No managed pages yet. Publish into a reserved namespace and it appears here."}
          </p>
        )
        : (
          <ul class="page-management-list">
            {pages.map((page) => (
              <li key={page.page_id} class="page-management-item">
                <div class="page-management-row">
                  <label class="page-management-select">
                    <input
                      type="checkbox"
                      checked={selected_page_ids.has(page.page_id)}
                      disabled={controls_busy}
                      onChange={() =>
                        toggle_selection(page.page_id)}
                    />
                    <span class="visually-hidden">Select {page.path}</span>
                  </label>
                  <a class="page-management-path" href={page.path}>
                    {page.path}
                  </a>
                  <ManagedDeliveryActions page={page} />
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
                  {page.tags.length > 0 && (
                    <span class="page-management-tags">
                      tags: {page.tags.join(", ")}
                    </span>
                  )}
                  <div class="page-management-actions">
                    <button
                      type="button"
                      disabled={controls_busy}
                      onClick={() =>
                        editor?.page_id === page.page_id
                          ? set_editor(null)
                          : open_editor(page)}
                    >
                      {editor?.page_id === page.page_id
                        ? "Close"
                        : page.content_type === "pdf"
                        ? "Inspect PDF"
                        : "Edit"}
                    </button>
                    <button
                      type="button"
                      disabled={controls_busy}
                      onClick={() => {
                        set_editor(null);
                        set_confirming_delete(null);
                        set_rename(
                          rename?.page_id === page.page_id ? null : {
                            page_id: page.page_id,
                            page_name: page.locator.page_name ?? "",
                          },
                        );
                      }}
                    >
                      {rename?.page_id === page.page_id
                        ? "Close rename"
                        : "Rename"}
                    </button>
                    {page.content_type === "md-page" && (
                      <button
                        type="button"
                        disabled={controls_busy}
                        onClick={() => duplicate_page(page)}
                      >
                        Duplicate
                      </button>
                    )}
                    <button
                      type="button"
                      disabled={controls_busy}
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
                            disabled={controls_busy}
                            onClick={() => remove(page)}
                          >
                            Confirm delete
                          </button>
                          <button
                            type="button"
                            disabled={controls_busy}
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
                          disabled={controls_busy}
                          onClick={() => remove(page)}
                        >
                          Delete
                        </button>
                      )}
                  </div>
                </div>

                {rename?.page_id === page.page_id && (
                  <form
                    class="page-management-rename"
                    onSubmit={(event) => {
                      event.preventDefault();
                      rename_page(page);
                    }}
                  >
                    <label>
                      Page name
                      <input
                        value={rename.page_name}
                        placeholder="Empty makes the default page"
                        onInput={(event) =>
                          set_rename({
                            page_id: page.page_id,
                            page_name: event.currentTarget.value,
                          })}
                      />
                    </label>
                    <button type="submit" disabled={controls_busy}>
                      Save name
                    </button>
                    <button
                      type="button"
                      disabled={controls_busy}
                      onClick={() => set_rename(null)}
                    >
                      Cancel
                    </button>
                  </form>
                )}

                {editor?.kind === "md-page" &&
                  editor.page_id === page.page_id && (
                  <form
                    class="page-management-editor"
                    onSubmit={(
                      event: JSX.TargetedSubmitEvent<HTMLFormElement>,
                    ) => {
                      event.preventDefault();
                      save_md_editor(page);
                    }}
                  >
                    <ManagedTagsEditor
                      value={editor.tags_input}
                      on_input={(value) =>
                        set_editor((current) =>
                          current?.kind !== "md-page"
                            ? current
                            : { ...current, tags_input: value }
                        )}
                    />
                    <PageEditor
                      markdown={editor.markdown}
                      css={editor.css}
                      on_markdown_input={(value) =>
                        set_editor((current) =>
                          current?.kind !== "md-page"
                            ? current
                            : { ...current, markdown: value }
                        )}
                      on_css_input={(value) =>
                        set_editor((current) =>
                          current?.kind !== "md-page"
                            ? current
                            : { ...current, css: value }
                        )}
                      previewer={page_previewer}
                    />
                    <div class="page-management-editor-actions">
                      <button type="submit" disabled={editor.saving}>
                        {editor.saving ? "Saving…" : "Save content and tags"}
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

                {editor?.kind === "pdf" &&
                  editor.page_id === page.page_id && (
                  <form
                    class="page-management-editor page-management-pdf-editor"
                    onSubmit={(
                      event: JSX.TargetedSubmitEvent<HTMLFormElement>,
                    ) => {
                      event.preventDefault();
                      save_pdf_editor(page);
                    }}
                  >
                    <div>
                      <h3>PDF metadata</h3>
                      <dl class="page-management-pdf-metadata">
                        <div>
                          <dt>Filename</dt>
                          <dd>{editor.metadata.filename}</dd>
                        </div>
                        <div>
                          <dt>Format</dt>
                          <dd>
                            PDF {editor.metadata.pdf_version} ·{" "}
                            {format_size_bytes(editor.metadata.size_bytes)}
                          </dd>
                        </div>
                        <div>
                          <dt>Media type</dt>
                          <dd>{editor.metadata.media_type}</dd>
                        </div>
                      </dl>
                    </div>
                    <ManagedTagsEditor
                      value={editor.tags_input}
                      on_input={(value) =>
                        set_editor((current) =>
                          current?.kind !== "pdf"
                            ? current
                            : { ...current, tags_input: value }
                        )}
                    />
                    <PdfFileSelection
                      view={pdf_replacement_file_view}
                      name="replacement_file"
                      input_id={`pdf-replacement-${page.page_id}`}
                      label="Replacement PDF"
                      required
                      on_select={(file) =>
                        set_editor((current) =>
                          current?.kind !== "pdf"
                            ? current
                            : { ...current, selected_file: file }
                        )}
                    />
                    <p class="field-hint">
                      Replacement keeps the current preview and download
                      endpoints and is bound to revision{" "}
                      {page.revision}. A changed page is refreshed and never
                      retried silently.
                    </p>
                    <div class="page-management-editor-actions">
                      <button
                        type="submit"
                        disabled={editor.saving ||
                          editor.selected_file === null}
                      >
                        {editor.saving
                          ? "Replacing…"
                          : "Replace PDF and save tags"}
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
          disabled={loading_more || controls_busy}
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
        {bulk_results.length > 0 && (
          <ul class="page-management-bulk-results">
            {bulk_results.map((result) => (
              <li
                key={result.page_id}
                class={result.ok ? "" : "error-message"}
              >
                <code>{result.path}</code>: {result.outcome}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

interface ManagedDeliveryActionsProps {
  readonly page: PageManagementSummary;
}

/** Renders only delivery actions derived by the raw endpoint presenter. */
function ManagedDeliveryActions({ page }: ManagedDeliveryActionsProps) {
  const pdf_links = managed_pdf_delivery_links(page);
  if (pdf_links !== null) {
    return (
      <nav
        class="page-management-endpoints page-management-pdf-actions"
        aria-label={`${page.path} PDF delivery actions`}
      >
        <a
          href={pdf_links.preview.path}
          target="_blank"
          rel="noopener noreferrer"
        >
          Preview PDF
        </a>
        {pdf_links.downloads.map((endpoint) => (
          <a key={endpoint.path} href={endpoint.path}>
            Download PDF: {endpoint.path}
          </a>
        ))}
      </nav>
    );
  }
  if (page.endpoints.alternates.length === 0) return null;
  return (
    <nav
      class="page-management-endpoints"
      aria-label={`${page.path} alternate delivery endpoints`}
    >
      {page.endpoints.alternates.map((endpoint) => (
        <a key={endpoint.path} href={endpoint.path}>
          {endpoint.delivery_profile}: {endpoint.path}
        </a>
      ))}
    </nav>
  );
}

interface ManagedTagsEditorProps {
  readonly value: string;
  readonly on_input: (value: string) => void;
}

function ManagedTagsEditor({ value, on_input }: ManagedTagsEditorProps) {
  return (
    <label class="page-management-tags-editor">
      Tags
      <input
        value={value}
        placeholder="notes, work"
        onInput={(event) => on_input(event.currentTarget.value)}
      />
      <small>
        Comma-separated; up to 10 canonical tags. Empty clears all tags.
      </small>
    </label>
  );
}

function page_word(count: number): string {
  return count === 1 ? "page" : "pages";
}

function bulk_error_label(error: string): string {
  switch (error) {
    case "not_found":
      return "not found";
    case "revision_conflict":
      return "changed elsewhere";
    case "revision_exhausted":
      return "revision limit reached";
    default:
      return error;
  }
}

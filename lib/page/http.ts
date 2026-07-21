import { csrf_tokens_match } from "../http/csrf.ts";
import {
  is_json_media_type,
  read_bounded_request_text,
} from "../http/request-body.ts";
import { prefixed, strict_object } from "../http/strict-object.ts";
import type { Session } from "../session/model.ts";
import { max_page_list_cursor_length } from "./cursor.ts";
import type { PageEndpointSetIntent } from "./endpoint.ts";
import { format_page_etag, parse_page_etag } from "./etag.ts";
import type {
  BulkChangeManagedPageAccessResult,
  BulkDeleteManagedPagesResult,
  CreateManagedPageResult,
  DeleteManagedPageResult,
  DuplicateManagedPageResult,
  InspectManagedPageResult,
  ListManagedPagesResult,
  ManagedPageBulkAccessChanger,
  ManagedPageBulkDeleter,
  ManagedPageCreator,
  ManagedPageDeleter,
  ManagedPageDuplicator,
  ManagedPageInspection,
  ManagedPageInspector,
  ManagedPageLister,
  ManagedPageRenamer,
  ManagedPageRevisionSelection,
  ManagedPageUpdater,
  PageSummary,
  PublishTrialPageResult,
  RenameManagedPageResult,
  TrialPagePublisher,
  UpdateManagedPageResult,
  UserPageActor,
} from "./interfaces.ts";
import { is_valid_page_id, type PageAccess } from "./model.ts";
import {
  type PdfMultipartDecodeFailure,
  type PdfMultipartDecoder,
  WebPdfMultipartDecoder,
} from "./pdf-http.ts";

/** One bound covers create and replacement content before handler limits run. */
export const page_request_max_bytes = 96 * 1024;
export const page_list_query_max_length = 2 * 1024;
export const page_list_namespace_max_length = 256;

export interface PageHttpRequestContext {
  readonly request_id: string;
  readonly session: Session;
}

export type PageHttpApplication =
  & TrialPagePublisher
  & ManagedPageCreator
  & ManagedPageLister
  & ManagedPageInspector
  & ManagedPageUpdater
  & ManagedPageDeleter
  & ManagedPageRenamer
  & ManagedPageDuplicator
  & ManagedPageBulkAccessChanger
  & ManagedPageBulkDeleter;

/** Fresh-independent collection, item, action, and bulk page boundary. */
export interface PageHttpHandler {
  collection(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response>;
  item(request: Request, context: PageHttpRequestContext): Promise<Response>;
  /** `POST /api/pages/:page_id/(rename|duplicate)` action boundary. */
  item_action(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response>;
  /** `POST /api/pages/bulk/(access|delete)` command boundary. */
  bulk(request: Request, context: PageHttpRequestContext): Promise<Response>;
}

export interface PageHttpAdapterOptions {
  readonly pages: PageHttpApplication;
  readonly pdf_multipart_decoder?: PdfMultipartDecoder;
}

type CreateBody =
  & (
    | {
      locator: { namespace: string; page_name?: string };
      endpoint_set?: never;
    }
    | { locator?: never; endpoint_set: PageEndpointSetIntent }
  )
  & {
    access: PageAccess;
    tags?: string[];
    content: { content_type: string; input: unknown };
  };

interface PatchBody {
  access?: PageAccess;
  tags?: string[];
  content?: { content_type: string; input: unknown };
  endpoint_set?: PageEndpointSetIntent;
}

interface RenameBody {
  page_name?: string;
}

interface BulkAccessBody {
  access: PageAccess;
  selection: ManagedPageRevisionSelection[];
}

interface BulkDeleteBody {
  selection: ManagedPageRevisionSelection[];
}

type DecodeResult<Value> =
  | { ok: true; value: Value }
  | { ok: false; detail: string };

export class PageHttpAdapter implements PageHttpHandler {
  readonly #pages: PageHttpApplication;
  readonly #pdf_multipart_decoder: PdfMultipartDecoder;

  constructor(options: PageHttpAdapterOptions) {
    this.#pages = options.pages;
    this.#pdf_multipart_decoder = options.pdf_multipart_decoder ??
      new WebPdfMultipartDecoder();
  }

  collection(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    if (request.method === "GET") return this.#list(request, context);
    if (request.method === "POST") return this.#create(request, context);
    return Promise.resolve(method_not_allowed_response("GET, POST"));
  }

  item(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    if (request.method === "GET") return this.#inspect(request, context);
    if (request.method === "PATCH") return this.#update(request, context);
    if (request.method === "DELETE") return this.#delete(request, context);
    return Promise.resolve(method_not_allowed_response("GET, PATCH, DELETE"));
  }

  item_action(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return Promise.resolve(method_not_allowed_response("POST"));
    }
    return this.#item_action(request, context);
  }

  bulk(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    if (request.method !== "POST") {
      return Promise.resolve(method_not_allowed_response("POST"));
    }
    return this.#bulk(request, context);
  }

  async #create(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const session = context.session;
    if (
      session.kind === "guest" && request.headers.has("x-csrf-token")
    ) {
      return error_response(
        401,
        "not_authenticated",
        "creator publication requires a current signed-in session",
      );
    }
    if (
      session.kind === "authenticated" &&
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return invalid_csrf_response();
    }

    const decoded = await decode_create_request_body(
      request,
      this.#pdf_multipart_decoder,
    );
    if (!decoded.ok) return decoded.response;
    const command = {
      ...(decoded.value.endpoint_set === undefined
        ? { locator: decoded.value.locator! }
        : { endpoint_set: decoded.value.endpoint_set }),
      access: decoded.value.access,
      content: decoded.value.content,
    };
    if (session.kind === "guest") {
      if (decoded.value.tags !== undefined) {
        return error_response(
          422,
          "invalid_tags",
          "trial pages do not accept tags",
        );
      }
      const result = await this.#pages.publish_trial({
        ...command,
        actor: { kind: "guest" },
      });
      return create_result_response(request.url, result, false);
    }
    const result = await this.#pages.create_managed({
      ...command,
      ...(decoded.value.tags === undefined ? {} : { tags: decoded.value.tags }),
      actor: actor_from_session(session),
    });
    return create_result_response(request.url, result, true);
  }

  async #list(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const actor = authenticated_actor(context.session);
    if (actor === null) return authentication_required_response();
    const query = decode_list_query(request.url);
    if (!query.ok) {
      return error_response(400, "invalid_query", query.detail);
    }
    const result = await this.#pages.list_managed({ actor, ...query.value });
    if (!result.ok) return list_failure_response(result);
    return json_response(200, {
      ok: true,
      pages: result.pages.map((page) => present_summary(page, true)),
      next_cursor: result.next_cursor,
    });
  }

  async #inspect(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const actor = authenticated_actor(context.session);
    if (actor === null) return authentication_required_response();
    const target = decode_item_target(request.url);
    if (!target.ok) return target.response;
    const result = await this.#pages.inspect_managed({
      actor,
      page_id: target.page_id,
    });
    if (!result.ok) return inspect_failure_response(result);
    return inspection_response(result.page);
  }

  async #update(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const session = context.session;
    if (session.kind !== "authenticated") {
      return authentication_required_response();
    }
    const actor = actor_from_session(session);
    if (
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return invalid_csrf_response();
    }
    const target = decode_item_target(request.url);
    if (!target.ok) return target.response;
    const precondition = decode_precondition(request, target.page_id);
    if (!precondition.ok) return precondition.response;
    const decoded = await decode_update_request_body(
      request,
      this.#pdf_multipart_decoder,
    );
    if (!decoded.ok) return decoded.response;
    const result = await this.#pages.update_managed({
      actor,
      page_id: target.page_id,
      expected_revision: precondition.revision,
      patch: decoded.value,
    });
    if (!result.ok) return update_failure_response(result);
    return inspection_response(result.page);
  }

  async #delete(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const session = context.session;
    if (session.kind !== "authenticated") {
      return authentication_required_response();
    }
    const actor = actor_from_session(session);
    if (
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return invalid_csrf_response();
    }
    const target = decode_item_target(request.url);
    if (!target.ok) return target.response;
    const precondition = decode_precondition(request, target.page_id);
    if (!precondition.ok) return precondition.response;
    const body = await read_bounded_request_text(request, 0);
    if (!body.ok || body.text !== "") {
      return error_response(
        400,
        "invalid_request",
        "DELETE requests must not include a body",
      );
    }
    const result = await this.#pages.delete_managed({
      actor,
      page_id: target.page_id,
      expected_revision: precondition.revision,
    });
    if (!result.ok) return delete_failure_response(result);
    return new Response(null, {
      status: 204,
      headers: { "cache-control": "no-store" },
    });
  }

  async #item_action(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const session = context.session;
    if (session.kind !== "authenticated") {
      return authentication_required_response();
    }
    const actor = actor_from_session(session);
    if (
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return invalid_csrf_response();
    }
    const target = decode_action_target(request.url);
    if (!target.ok) return target.response;
    const precondition = decode_precondition(request, target.page_id);
    if (!precondition.ok) return precondition.response;
    if (target.action === "duplicate") {
      const body = await read_bounded_request_text(request, 0);
      if (!body.ok || body.text !== "") {
        return error_response(
          400,
          "invalid_request",
          "duplicate requests must not include a body",
        );
      }
      const result = await this.#pages.duplicate_managed({
        actor,
        page_id: target.page_id,
        expected_revision: precondition.revision,
      });
      if (!result.ok) return duplicate_failure_response(result);
      return action_success_response(201, result.outcome, result.page, {
        location: `/api/pages/${result.page.page_id}`,
      });
    }
    const decoded = await decode_json_body(request, decode_rename_body);
    if (!decoded.ok) return decoded.response;
    const result = await this.#pages.rename_managed({
      actor,
      page_id: target.page_id,
      expected_revision: precondition.revision,
      ...(decoded.value.page_name === undefined
        ? {}
        : { page_name: decoded.value.page_name }),
    });
    if (!result.ok) return rename_failure_response(result);
    return action_success_response(200, result.outcome, result.page);
  }

  async #bulk(
    request: Request,
    context: PageHttpRequestContext,
  ): Promise<Response> {
    const session = context.session;
    if (session.kind !== "authenticated") {
      return authentication_required_response();
    }
    const actor = actor_from_session(session);
    if (
      !csrf_tokens_match(
        session.csrf_token,
        request.headers.get("x-csrf-token") ?? "",
      )
    ) {
      return invalid_csrf_response();
    }
    const target = decode_bulk_target(request.url);
    if (!target.ok) return target.response;
    if (target.operation === "access") {
      const decoded = await decode_json_body(request, decode_bulk_access_body);
      if (!decoded.ok) return decoded.response;
      const result = await this.#pages.bulk_change_managed_access({
        actor,
        access: decoded.value.access,
        selection: decoded.value.selection,
      });
      if (!result.ok) return bulk_failure_response(result);
      return json_response(200, {
        ok: true,
        results: result.results.map((item) =>
          item.ok
            ? {
              page_id: item.page_id,
              ok: true,
              page: present_summary(item.page, true),
            }
            : { page_id: item.page_id, ok: false, error: item.reason }
        ),
      });
    }
    const decoded = await decode_json_body(request, decode_bulk_delete_body);
    if (!decoded.ok) return decoded.response;
    const result = await this.#pages.bulk_delete_managed({
      actor,
      selection: decoded.value.selection,
    });
    if (!result.ok) return bulk_failure_response(result);
    return json_response(200, {
      ok: true,
      results: result.results.map((item) =>
        item.ok
          ? { page_id: item.page_id, ok: true }
          : { page_id: item.page_id, ok: false, error: item.reason }
      ),
    });
  }
}

function authenticated_actor(session: Session): UserPageActor | null {
  return session.kind === "authenticated" ? actor_from_session(session) : null;
}

function actor_from_session(
  session: Extract<Session, { kind: "authenticated" }>,
): UserPageActor {
  return { kind: "user", user_id: session.user_id };
}

async function decode_create_request_body(
  request: Request,
  pdf_decoder: PdfMultipartDecoder,
): Promise<
  | { ok: true; value: CreateBody }
  | { ok: false; response: Response }
> {
  if (is_json_media_type(request.headers.get("content-type"))) {
    return await decode_json_body(request, decode_create_body);
  }
  const decoded = await pdf_decoder.decode_create(request);
  return decoded.ok
    ? { ok: true, value: decoded.value }
    : { ok: false, response: pdf_multipart_failure_response(decoded) };
}

async function decode_update_request_body(
  request: Request,
  pdf_decoder: PdfMultipartDecoder,
): Promise<
  | { ok: true; value: PatchBody }
  | { ok: false; response: Response }
> {
  if (is_json_media_type(request.headers.get("content-type"))) {
    return await decode_json_body(request, decode_patch_body);
  }
  const decoded = await pdf_decoder.decode_update(request);
  return decoded.ok
    ? { ok: true, value: decoded.value }
    : { ok: false, response: pdf_multipart_failure_response(decoded) };
}

function pdf_multipart_failure_response(
  failure: PdfMultipartDecodeFailure,
): Response {
  switch (failure.reason) {
    case "unsupported_media_type":
      return error_response(415, failure.reason, failure.detail);
    case "too_large":
      return error_response(413, "request_too_large", failure.detail);
    case "invalid_json":
      return error_response(400, failure.reason, failure.detail);
    case "unreadable":
    case "malformed_multipart":
    case "invalid_metadata":
      return error_response(400, "invalid_request", failure.detail);
  }
}

async function decode_json_body<Value>(
  request: Request,
  decode: (input: unknown) => DecodeResult<Value>,
): Promise<
  | { ok: true; value: Value }
  | { ok: false; response: Response }
> {
  if (!is_json_media_type(request.headers.get("content-type"))) {
    return {
      ok: false,
      response: error_response(
        415,
        "unsupported_media_type",
        "content-type must be application/json",
      ),
    };
  }
  const body_read = await read_bounded_request_text(
    request,
    page_request_max_bytes,
  );
  if (!body_read.ok) {
    return {
      ok: false,
      response: body_read.reason === "too_large"
        ? error_response(
          413,
          "request_too_large",
          `request body exceeds ${page_request_max_bytes} bytes`,
        )
        : error_response(400, "invalid_json", "request body could not be read"),
    };
  }
  let input: unknown;
  try {
    input = JSON.parse(body_read.text);
  } catch {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_json",
        "request body is not valid JSON",
      ),
    };
  }
  const decoded = decode(input);
  return decoded.ok ? decoded : {
    ok: false,
    response: error_response(400, "invalid_request", decoded.detail),
  };
}

function decode_create_body(input: unknown): DecodeResult<CreateBody> {
  const body = strict_object(input, ["locator", "access", "tags?", "content"]);
  if (!body.ok) return body;
  if (typeof body.value.access !== "string") {
    return { ok: false, detail: "access must be a string" };
  }
  const tags = decode_tags_field(body.value.tags);
  if (!tags.ok) return tags;
  const locator = strict_object(body.value.locator, [
    "namespace",
    "page_name?",
  ]);
  if (!locator.ok) return prefixed(locator, "locator");
  if (typeof locator.value.namespace !== "string") {
    return { ok: false, detail: "locator.namespace must be a string" };
  }
  if (
    locator.value.page_name !== undefined &&
    typeof locator.value.page_name !== "string"
  ) {
    return {
      ok: false,
      detail: "locator.page_name must be a string when present",
    };
  }
  const content = decode_content_command(body.value.content);
  if (!content.ok) return content;
  return {
    ok: true,
    value: {
      locator: locator.value.page_name === undefined
        ? { namespace: locator.value.namespace }
        : {
          namespace: locator.value.namespace,
          page_name: locator.value.page_name,
        },
      access: body.value.access as PageAccess,
      ...(tags.value === undefined ? {} : { tags: tags.value }),
      content: content.value,
    },
  };
}

function decode_patch_body(input: unknown): DecodeResult<PatchBody> {
  const body = strict_object(input, ["access?", "tags?", "content?"]);
  if (!body.ok) return body;
  if (
    body.value.access !== undefined && typeof body.value.access !== "string"
  ) {
    return { ok: false, detail: "access must be a string when present" };
  }
  const tags = decode_tags_field(body.value.tags);
  if (!tags.ok) return tags;
  let content: PatchBody["content"];
  if (body.value.content !== undefined) {
    const decoded = decode_content_command(body.value.content);
    if (!decoded.ok) return decoded;
    content = decoded.value;
  }
  return {
    ok: true,
    value: {
      ...(body.value.access === undefined
        ? {}
        : { access: body.value.access as PageAccess }),
      ...(tags.value === undefined ? {} : { tags: tags.value }),
      ...(content === undefined ? {} : { content }),
    },
  };
}

function decode_tags_field(
  input: unknown,
): DecodeResult<string[] | undefined> {
  if (input === undefined) return { ok: true, value: undefined };
  if (
    !Array.isArray(input) ||
    input.some((candidate) => typeof candidate !== "string")
  ) {
    return {
      ok: false,
      detail: "tags must be an array of strings when present",
    };
  }
  return { ok: true, value: input as string[] };
}

function decode_rename_body(input: unknown): DecodeResult<RenameBody> {
  const body = strict_object(input, ["page_name?"]);
  if (!body.ok) return body;
  if (
    body.value.page_name !== undefined &&
    typeof body.value.page_name !== "string"
  ) {
    return { ok: false, detail: "page_name must be a string when present" };
  }
  return {
    ok: true,
    value: body.value.page_name === undefined
      ? {}
      : { page_name: body.value.page_name },
  };
}

function decode_bulk_access_body(input: unknown): DecodeResult<BulkAccessBody> {
  const body = strict_object(input, ["access", "selection"]);
  if (!body.ok) return body;
  if (typeof body.value.access !== "string") {
    return { ok: false, detail: "access must be a string" };
  }
  const selection = decode_bulk_selection(body.value.selection);
  if (!selection.ok) return selection;
  return {
    ok: true,
    value: {
      access: body.value.access as PageAccess,
      selection: selection.value,
    },
  };
}

function decode_bulk_delete_body(input: unknown): DecodeResult<BulkDeleteBody> {
  const body = strict_object(input, ["selection"]);
  if (!body.ok) return body;
  const selection = decode_bulk_selection(body.value.selection);
  if (!selection.ok) return selection;
  return { ok: true, value: { selection: selection.value } };
}

function decode_bulk_selection(
  input: unknown,
): DecodeResult<ManagedPageRevisionSelection[]> {
  if (!Array.isArray(input)) {
    return { ok: false, detail: "selection must be an array" };
  }
  const selection: ManagedPageRevisionSelection[] = [];
  for (const candidate of input) {
    const item = strict_object(candidate, ["page_id", "expected_revision"]);
    if (!item.ok) return prefixed(item, "selection");
    if (typeof item.value.page_id !== "string") {
      return { ok: false, detail: "selection: page_id must be a string" };
    }
    if (typeof item.value.expected_revision !== "number") {
      return {
        ok: false,
        detail: "selection: expected_revision must be a number",
      };
    }
    selection.push({
      page_id: item.value.page_id,
      expected_revision: item.value.expected_revision,
    });
  }
  return { ok: true, value: selection };
}

function decode_content_command(
  input: unknown,
): DecodeResult<{ content_type: string; input: unknown }> {
  const content = strict_object(input, ["content_type", "input"]);
  if (!content.ok) return prefixed(content, "content");
  if (typeof content.value.content_type !== "string") {
    return { ok: false, detail: "content.content_type must be a string" };
  }
  return {
    ok: true,
    value: {
      content_type: content.value.content_type,
      input: content.value.input,
    },
  };
}

function decode_list_query(request_url: string): DecodeResult<{
  namespace?: string;
  page_name_query?: string;
  access?: PageAccess;
  tag?: string;
  limit: number;
  cursor?: string;
}> {
  const url = new URL(request_url);
  if (url.search.length > page_list_query_max_length) {
    return { ok: false, detail: "query is too large" };
  }
  const allowed = ["namespace", "name", "access", "tag", "limit", "cursor"];
  for (const key of url.searchParams.keys()) {
    if (!allowed.includes(key)) {
      return { ok: false, detail: `unknown query parameter: ${key}` };
    }
    if (url.searchParams.getAll(key).length !== 1) {
      return { ok: false, detail: `duplicate query parameter: ${key}` };
    }
  }
  const namespace = url.searchParams.get("namespace");
  if (namespace !== null && namespace.length > page_list_namespace_max_length) {
    return { ok: false, detail: "namespace query is too large" };
  }
  const raw_limit = url.searchParams.get("limit");
  let limit = 50;
  if (raw_limit !== null) {
    if (!/^[1-9][0-9]{0,2}$/.test(raw_limit)) {
      return { ok: false, detail: "limit must be an integer from 1 to 100" };
    }
    limit = Number(raw_limit);
    if (limit > 100) {
      return { ok: false, detail: "limit must be an integer from 1 to 100" };
    }
  }
  const cursor = url.searchParams.get("cursor");
  if (
    cursor !== null &&
    (cursor === "" || cursor.length > max_page_list_cursor_length)
  ) {
    return { ok: false, detail: "cursor is invalid" };
  }
  const name = url.searchParams.get("name");
  const access = url.searchParams.get("access");
  const tag = url.searchParams.get("tag");
  return {
    ok: true,
    value: {
      ...(namespace === null ? {} : { namespace }),
      ...(name === null ? {} : { page_name_query: name }),
      ...(access === null ? {} : { access: access as PageAccess }),
      ...(tag === null ? {} : { tag }),
      limit,
      ...(cursor === null ? {} : { cursor }),
    },
  };
}

function decode_item_target(request_url: string):
  | { ok: true; page_id: string }
  | { ok: false; response: Response } {
  const url = new URL(request_url);
  if (url.search !== "") {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_query",
        "page item requests do not accept query parameters",
      ),
    };
  }
  const match = /^\/api\/pages\/([^/]+)$/.exec(url.pathname);
  if (match === null || !is_valid_page_id(match[1])) {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_page_id",
        "page_id must be one route-safe opaque value",
      ),
    };
  }
  return { ok: true, page_id: match[1] };
}

function decode_action_target(request_url: string):
  | { ok: true; page_id: string; action: "rename" | "duplicate" }
  | { ok: false; response: Response } {
  const url = new URL(request_url);
  if (url.search !== "") {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_query",
        "page action requests do not accept query parameters",
      ),
    };
  }
  const match = /^\/api\/pages\/([^/]+)\/(rename|duplicate)$/.exec(
    url.pathname,
  );
  if (match === null) {
    return {
      ok: false,
      response: error_response(404, "not_found", "page action was not found"),
    };
  }
  if (!is_valid_page_id(match[1])) {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_page_id",
        "page_id must be one route-safe opaque value",
      ),
    };
  }
  return {
    ok: true,
    page_id: match[1],
    action: match[2] as "rename" | "duplicate",
  };
}

function decode_bulk_target(request_url: string):
  | { ok: true; operation: "access" | "delete" }
  | { ok: false; response: Response } {
  const url = new URL(request_url);
  if (url.search !== "") {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_query",
        "bulk requests do not accept query parameters",
      ),
    };
  }
  const match = /^\/api\/pages\/bulk\/(access|delete)$/.exec(url.pathname);
  if (match === null) {
    return {
      ok: false,
      response: error_response(404, "not_found", "bulk command was not found"),
    };
  }
  return { ok: true, operation: match[1] as "access" | "delete" };
}

function decode_precondition(
  request: Request,
  page_id: string,
):
  | { ok: true; revision: number }
  | { ok: false; response: Response } {
  const raw = request.headers.get("if-match");
  if (raw === null) {
    return {
      ok: false,
      response: error_response(
        428,
        "precondition_required",
        "If-Match must contain the current page ETag",
      ),
    };
  }
  const parsed = parse_page_etag(raw);
  if (parsed === null) {
    return {
      ok: false,
      response: error_response(
        400,
        "invalid_if_match",
        "If-Match must contain exactly one strong page ETag",
      ),
    };
  }
  if (parsed.page_id !== page_id) {
    return {
      ok: false,
      response: error_response(
        412,
        "precondition_failed",
        "page representation has changed",
      ),
    };
  }
  return { ok: true, revision: parsed.revision };
}

function create_result_response(
  request_url: string,
  result: PublishTrialPageResult | CreateManagedPageResult,
  managed: boolean,
): Response {
  if (!result.ok) return create_failure_response(result);
  const path = result.page.path;
  const management_url = `/api/pages/${result.page.page_id}`;
  const status = managed || result.outcome === "created" ? 201 : 200;
  const headers = new Headers({
    location: managed ? management_url : path,
  });
  if (managed) {
    headers.set(
      "etag",
      format_page_etag(result.page.page_id, result.page.revision),
    );
  }
  return json_response(
    status,
    {
      ok: true,
      outcome: result.outcome,
      page: present_summary(result.page, managed),
      path,
      url: new URL(path, request_url).href,
      ...(managed ? { management_url } : {}),
    },
    headers,
  );
}

function create_failure_response(
  result: Exclude<
    PublishTrialPageResult | CreateManagedPageResult,
    { ok: true }
  >,
): Response {
  switch (result.reason) {
    case "forbidden_namespace":
      return error_response(
        403,
        result.reason,
        "namespace is reserved by the platform",
      );
    case "namespace_reserved":
      return error_response(
        403,
        result.reason,
        "namespace is reserved by another authority",
      );
    case "private_requires_managed_page":
      return error_response(
        403,
        result.reason,
        "private access requires a managed page",
      );
    case "namespace_not_reserved":
      return error_response(
        409,
        result.reason,
        "creator must reserve the namespace before publishing",
      );
    case "page_exists":
      return error_response(
        409,
        result.reason,
        "a managed page already exists at this locator",
      );
    case "invalid_locator":
    case "invalid_access":
    case "invalid_tags":
    case "invalid_endpoint_count":
    case "namespace_mismatch":
    case "duplicate_locator":
    case "unsupported_delivery_profile":
      return error_response(422, result.reason, "page input is invalid");
    case "endpoint_conflict":
    case "revision_exhausted":
      return error_response(
        409,
        result.reason,
        "page endpoints cannot be replaced",
      );
    case "unknown_content_type":
      return error_response(
        422,
        result.reason,
        "content_type is not supported",
      );
    case "invalid_input":
      return error_response(422, result.reason, result.detail);
    case "page_id_generation_exhausted":
      return error_response(
        503,
        result.reason,
        "page creation is temporarily unavailable",
      );
  }
}

function list_failure_response(
  result: Exclude<ListManagedPagesResult, { ok: true }>,
): Response {
  switch (result.reason) {
    case "namespace_not_owned":
    case "forbidden_namespace":
      return error_response(404, "not_found", "namespace was not found");
    case "invalid_namespace":
      return error_response(
        422,
        result.reason,
        "namespace cannot be mapped to a direct URL",
      );
    case "invalid_filter":
      return error_response(400, result.reason, "page filter is invalid");
    case "invalid_cursor":
      return error_response(400, result.reason, "cursor is invalid");
  }
}

function inspect_failure_response(
  result: Exclude<InspectManagedPageResult, { ok: true }>,
): Response {
  return error_response(404, result.reason, "page was not found");
}

function update_failure_response(
  result: Exclude<UpdateManagedPageResult, { ok: true }>,
): Response {
  switch (result.reason) {
    case "not_found":
      return error_response(404, result.reason, "page was not found");
    case "revision_conflict":
      return error_response(
        412,
        "precondition_failed",
        "page representation has changed",
      );
    case "empty_patch":
      return error_response(
        400,
        result.reason,
        "PATCH must include access, tags, content, or a combination",
      );
    case "invalid_access":
    case "invalid_tags":
    case "invalid_input":
      return error_response(
        422,
        result.reason,
        result.reason === "invalid_input"
          ? result.detail
          : "page metadata is invalid",
      );
    case "forbidden_namespace":
    case "invalid_locator":
    case "invalid_endpoint_count":
    case "namespace_mismatch":
    case "duplicate_locator":
    case "unsupported_delivery_profile":
      return error_response(422, result.reason, "page endpoints are invalid");
    case "page_exists":
      return error_response(
        409,
        result.reason,
        "a managed page already claims an endpoint",
      );
    case "unknown_content_type":
      return error_response(
        422,
        result.reason,
        "content_type is not supported",
      );
    case "revision_exhausted":
      return error_response(
        409,
        result.reason,
        "page cannot accept another revision",
      );
  }
}

function delete_failure_response(
  result: Exclude<DeleteManagedPageResult, { ok: true }>,
): Response {
  return result.reason === "not_found"
    ? error_response(404, result.reason, "page was not found")
    : error_response(
      412,
      "precondition_failed",
      "page representation has changed",
    );
}

function rename_failure_response(
  result: Exclude<RenameManagedPageResult, { ok: true }>,
): Response {
  switch (result.reason) {
    case "not_found":
      return error_response(404, result.reason, "page was not found");
    case "revision_conflict":
      return error_response(
        412,
        "precondition_failed",
        "page representation has changed",
      );
    case "revision_exhausted":
      return error_response(
        409,
        result.reason,
        "page cannot accept another revision",
      );
    case "invalid_page_name":
      return error_response(
        422,
        result.reason,
        "page_name cannot be mapped to a direct URL",
      );
    case "page_exists":
      return error_response(
        409,
        result.reason,
        "a managed page already exists at this locator",
      );
  }
}

function duplicate_failure_response(
  result: Exclude<DuplicateManagedPageResult, { ok: true }>,
): Response {
  switch (result.reason) {
    case "not_found":
      return error_response(404, result.reason, "page was not found");
    case "revision_conflict":
      return error_response(
        412,
        "precondition_failed",
        "page representation has changed",
      );
    case "endpoint_set_required":
    case "forbidden_namespace":
    case "invalid_locator":
    case "invalid_endpoint_count":
    case "namespace_mismatch":
    case "duplicate_locator":
    case "unsupported_delivery_profile":
      return error_response(422, result.reason, "page endpoints are required");
    case "page_exists":
      return error_response(
        409,
        result.reason,
        "a managed page already claims an endpoint",
      );
    case "page_name_generation_exhausted":
    case "page_id_generation_exhausted":
      return error_response(
        503,
        result.reason,
        "page duplication is temporarily unavailable",
      );
  }
}

function bulk_failure_response(
  result:
    | Exclude<BulkChangeManagedPageAccessResult, { ok: true }>
    | Exclude<BulkDeleteManagedPagesResult, { ok: true }>,
): Response {
  return result.reason === "invalid_access"
    ? error_response(422, result.reason, "access is invalid")
    : error_response(
      422,
      result.reason,
      "selection must contain 1-100 distinct page/revision pairs",
    );
}

function inspection_response(page: ManagedPageInspection): Response {
  return json_response(
    200,
    {
      ok: true,
      page: {
        ...present_summary(page, true),
        content: structuredClone(page.content),
      },
    },
    { etag: format_page_etag(page.page_id, page.revision) },
  );
}

function action_success_response(
  status: number,
  outcome: string,
  page: ManagedPageInspection,
  extra_headers?: HeadersInit,
): Response {
  const headers = new Headers(extra_headers);
  headers.set("etag", format_page_etag(page.page_id, page.revision));
  return json_response(
    status,
    {
      ok: true,
      outcome,
      page: {
        ...present_summary(page, true),
        content: structuredClone(page.content),
      },
    },
    headers,
  );
}

function present_summary(page: PageSummary, managed: boolean) {
  return {
    page_id: page.page_id,
    locator: structuredClone(page.locator),
    path: page.path,
    endpoints: {
      canonical: present_endpoint_link(page.endpoints.canonical),
      alternates: page.endpoints.alternates.map(present_endpoint_link),
    },
    access: page.access,
    content_type: page.content_type,
    size_bytes: page.size_bytes,
    tags: [...page.tags],
    created_at: page.created_at.toISOString(),
    updated_at: page.updated_at.toISOString(),
    revision: page.revision,
    ...(managed
      ? {
        etag: format_page_etag(page.page_id, page.revision),
        management_url: `/api/pages/${page.page_id}`,
      }
      : {}),
  };
}

function present_endpoint_link(
  endpoint: PageSummary["endpoints"]["canonical"],
) {
  return {
    locator: structuredClone(endpoint.locator),
    path: endpoint.path,
    delivery_profile: endpoint.delivery_profile,
  };
}

function authentication_required_response(): Response {
  return error_response(
    401,
    "not_authenticated",
    "page management requires a signed-in creator",
  );
}

function invalid_csrf_response(): Response {
  return error_response(
    403,
    "invalid_csrf",
    "page mutation could not be authorized",
  );
}

function method_not_allowed_response(allow: string): Response {
  return error_response(
    405,
    "method_not_allowed",
    "request method is not supported",
    { allow },
  );
}

function error_response(
  status: number,
  error: string,
  detail: string,
  extra_headers?: HeadersInit,
): Response {
  return json_response(status, { ok: false, error, detail }, extra_headers);
}

function json_response(
  status: number,
  body: unknown,
  extra_headers?: HeadersInit,
): Response {
  const headers = new Headers(extra_headers);
  headers.set("content-type", "application/json; charset=utf-8");
  headers.set("cache-control", "no-store");
  return new Response(JSON.stringify(body), { status, headers });
}

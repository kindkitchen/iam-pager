export type GoogleDriveGatewayFailureReason =
  | "missing"
  | "unauthorized"
  | "unreachable"
  | "invalid_grant"
  | "provider_error";

export type GoogleDriveGatewayResult<T> =
  | { readonly ok: true; readonly value: T }
  | {
    readonly ok: false;
    readonly reason: GoogleDriveGatewayFailureReason;
    readonly retry_after_seconds?: number;
  };

export interface GoogleDriveFileStat {
  readonly file_id: string;
  readonly size_bytes: number;
  readonly md5_checksum?: string;
  readonly trashed: boolean;
}

export interface GoogleDriveAccessToken {
  readonly access_token: string;
  readonly expires_at: Date;
  readonly refresh_token?: string;
}

export interface GoogleDriveGateway {
  stat_file(input: {
    readonly access_token: string;
    readonly file_id: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveFileStat>>;
  fetch_file(input: {
    readonly access_token: string;
    readonly file_id: string;
    readonly max_bytes: number;
  }): Promise<GoogleDriveGatewayResult<Uint8Array>>;
  put_file(input: {
    readonly access_token: string;
    readonly body: Uint8Array;
    readonly media_type: string;
    readonly filename: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveFileStat>>;
  refresh_access_token(input: {
    readonly refresh_token: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveAccessToken>>;
}

const drive_api_base_url = "https://www.googleapis.com/drive/v3";
const drive_upload_base_url = "https://www.googleapis.com/upload/drive/v3";
const google_token_url = "https://oauth2.googleapis.com/token";
const retryable_google_reasons = new Set([
  "backendError",
  "rateLimitExceeded",
  "userRateLimitExceeded",
]);

/** Small Google Drive v3 REST gateway; provider policy stays outside HTTP. */
export class FetchGoogleDriveGateway implements GoogleDriveGateway {
  readonly #client_id: string;
  readonly #client_secret: string;
  readonly #fetch: typeof fetch;
  readonly #drive_api_base_url: string;
  readonly #drive_upload_base_url: string;
  readonly #token_url: string;
  readonly #request_timeout_ms: number;
  readonly #now: () => Date;

  constructor(options: {
    client_id: string;
    client_secret: string;
    fetcher?: typeof fetch;
    drive_api_base_url?: string;
    drive_upload_base_url?: string;
    token_url?: string;
    request_timeout_ms?: number;
    now?: () => Date;
  }) {
    if (!options.client_id || !options.client_secret) {
      throw new TypeError("Google Drive client credentials are required");
    }
    this.#client_id = options.client_id;
    this.#client_secret = options.client_secret;
    this.#fetch = options.fetcher ?? fetch;
    this.#drive_api_base_url = trim_trailing_slash(
      options.drive_api_base_url ?? drive_api_base_url,
    );
    this.#drive_upload_base_url = trim_trailing_slash(
      options.drive_upload_base_url ?? drive_upload_base_url,
    );
    this.#token_url = options.token_url ?? google_token_url;
    this.#request_timeout_ms = options.request_timeout_ms ?? 10_000;
    this.#now = options.now ?? (() => new Date());
    if (
      !Number.isSafeInteger(this.#request_timeout_ms) ||
      this.#request_timeout_ms <= 0
    ) throw new TypeError("request_timeout_ms must be a positive integer");
  }

  async stat_file(input: {
    readonly access_token: string;
    readonly file_id: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveFileStat>> {
    const url = new URL(
      `${this.#drive_api_base_url}/files/${encodeURIComponent(input.file_id)}`,
    );
    url.searchParams.set(
      "fields",
      "id,size,md5Checksum,trashed",
    );
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.#request(url, {
      headers: authorization_headers(input.access_token),
    });
    if (!response.ok) return response;
    if (!response.value.ok) {
      return await classify_drive_response(response.value);
    }
    return await parse_file_stat(response.value);
  }

  async fetch_file(input: {
    readonly access_token: string;
    readonly file_id: string;
    readonly max_bytes: number;
  }): Promise<GoogleDriveGatewayResult<Uint8Array>> {
    const url = new URL(
      `${this.#drive_api_base_url}/files/${encodeURIComponent(input.file_id)}`,
    );
    url.searchParams.set("alt", "media");
    url.searchParams.set("supportsAllDrives", "true");
    const response = await this.#request(url, {
      headers: authorization_headers(input.access_token),
    });
    if (!response.ok) return response;
    if (!response.value.ok) {
      return await classify_drive_response(response.value);
    }
    return await read_bounded_body(response.value, input.max_bytes);
  }

  async put_file(input: {
    readonly access_token: string;
    readonly body: Uint8Array;
    readonly media_type: string;
    readonly filename: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveFileStat>> {
    const boundary = `iam-pager-${crypto.randomUUID()}`;
    const metadata = new TextEncoder().encode(JSON.stringify({
      name: input.filename,
      appProperties: { iamPagerContent: "true" },
    }));
    const body = join_bytes([
      encode_text(
        `--${boundary}\r\ncontent-type: application/json; charset=UTF-8\r\n\r\n`,
      ),
      metadata,
      encode_text(
        `\r\n--${boundary}\r\ncontent-type: ${input.media_type}\r\n\r\n`,
      ),
      input.body,
      encode_text(`\r\n--${boundary}--\r\n`),
    ]);
    const url = new URL(`${this.#drive_upload_base_url}/files`);
    url.searchParams.set("uploadType", "multipart");
    url.searchParams.set("fields", "id,size,md5Checksum,trashed");
    const response = await this.#request(url, {
      method: "POST",
      headers: {
        ...authorization_headers(input.access_token),
        "content-type": `multipart/related; boundary=${boundary}`,
      },
      body: body.buffer as ArrayBuffer,
    });
    if (!response.ok) return response;
    if (!response.value.ok) {
      return await classify_drive_response(response.value);
    }
    return await parse_file_stat(response.value);
  }

  async refresh_access_token(input: {
    readonly refresh_token: string;
  }): Promise<GoogleDriveGatewayResult<GoogleDriveAccessToken>> {
    const response = await this.#request(this.#token_url, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: this.#client_id,
        client_secret: this.#client_secret,
        refresh_token: input.refresh_token,
        grant_type: "refresh_token",
      }),
    });
    if (!response.ok) return response;
    if (!response.value.ok) {
      if (response.value.status === 400 || response.value.status === 401) {
        const error = await read_json_record(response.value);
        if (error?.error === "invalid_grant") {
          return { ok: false, reason: "invalid_grant" };
        }
      }
      return await classify_drive_response(response.value);
    }
    const value = await read_json_record(response.value);
    const access_token = value?.access_token;
    const expires_in = value?.expires_in;
    if (
      typeof access_token !== "string" || access_token.length === 0 ||
      typeof expires_in !== "number" || !Number.isFinite(expires_in) ||
      expires_in <= 0
    ) return { ok: false, reason: "provider_error" };
    const refresh_token = value?.refresh_token;
    if (refresh_token !== undefined && typeof refresh_token !== "string") {
      return { ok: false, reason: "provider_error" };
    }
    return {
      ok: true,
      value: {
        access_token,
        expires_at: new Date(this.#now().getTime() + expires_in * 1000),
        ...(refresh_token === undefined ? {} : { refresh_token }),
      },
    };
  }

  async #request(
    input: string | URL,
    init: RequestInit,
  ): Promise<GoogleDriveGatewayResult<Response>> {
    try {
      return {
        ok: true,
        value: await this.#fetch(input, {
          ...init,
          redirect: "error",
          signal: AbortSignal.timeout(this.#request_timeout_ms),
        }),
      };
    } catch {
      return { ok: false, reason: "unreachable" };
    }
  }
}

async function classify_drive_response(
  response: Response,
): Promise<GoogleDriveGatewayResult<never>> {
  if (response.status === 401) return { ok: false, reason: "unauthorized" };
  if (response.status === 404 || response.status === 410) {
    return { ok: false, reason: "missing" };
  }
  if (response.status === 403) {
    const body = await read_json_record(response);
    const reasons = google_error_reasons(body);
    if (reasons.some((reason) => retryable_google_reasons.has(reason))) {
      return unreachable_response(response);
    }
    return { ok: false, reason: "missing" };
  }
  if (response.status === 429 || response.status >= 500) {
    return unreachable_response(response);
  }
  return { ok: false, reason: "provider_error" };
}

function unreachable_response(
  response: Response,
): GoogleDriveGatewayResult<never> {
  const retry_after_seconds = parse_retry_after(
    response.headers.get("retry-after"),
  );
  return {
    ok: false,
    reason: "unreachable",
    ...(retry_after_seconds === undefined ? {} : { retry_after_seconds }),
  };
}

async function parse_file_stat(
  response: Response,
): Promise<GoogleDriveGatewayResult<GoogleDriveFileStat>> {
  const value = await read_json_record(response);
  if (value === null) return { ok: false, reason: "provider_error" };
  const file_id = value.id;
  const size_value = value.size;
  const size_bytes = typeof size_value === "string" && /^\d+$/.test(size_value)
    ? Number(size_value)
    : size_value;
  const md5_checksum = value.md5Checksum;
  if (
    typeof file_id !== "string" || file_id.length === 0 ||
    !Number.isSafeInteger(size_bytes) || (size_bytes as number) < 0 ||
    typeof value.trashed !== "boolean" ||
    (md5_checksum !== undefined && typeof md5_checksum !== "string")
  ) return { ok: false, reason: "provider_error" };
  return {
    ok: true,
    value: {
      file_id,
      size_bytes: size_bytes as number,
      trashed: value.trashed,
      ...(md5_checksum === undefined ? {} : { md5_checksum }),
    },
  };
}

async function read_bounded_body(
  response: Response,
  max_bytes: number,
): Promise<GoogleDriveGatewayResult<Uint8Array>> {
  const content_length = response.headers.get("content-length");
  if (
    content_length !== null && /^\d+$/.test(content_length) &&
    Number(content_length) > max_bytes
  ) {
    await response.body?.cancel();
    return { ok: false, reason: "missing" };
  }
  if (response.body === null) return { ok: true, value: new Uint8Array() };
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const chunk = await reader.read();
      if (chunk.done) break;
      size += chunk.value.byteLength;
      if (size > max_bytes) {
        await reader.cancel();
        return { ok: false, reason: "missing" };
      }
      chunks.push(chunk.value);
    }
  } catch {
    return { ok: false, reason: "unreachable" };
  }
  return { ok: true, value: join_bytes(chunks, size) };
}

async function read_json_record(
  response: Response,
): Promise<Record<string, unknown> | null> {
  try {
    const value: unknown = await response.json();
    return typeof value === "object" && value !== null && !Array.isArray(value)
      ? value as Record<string, unknown>
      : null;
  } catch {
    return null;
  }
}

function google_error_reasons(value: Record<string, unknown> | null): string[] {
  const error = value?.error;
  if (typeof error !== "object" || error === null || Array.isArray(error)) {
    return [];
  }
  const errors = (error as Record<string, unknown>).errors;
  if (!Array.isArray(errors)) return [];
  return errors.flatMap((candidate) => {
    if (
      typeof candidate !== "object" || candidate === null ||
      Array.isArray(candidate)
    ) return [];
    const reason = (candidate as Record<string, unknown>).reason;
    return typeof reason === "string" ? [reason] : [];
  });
}

function parse_retry_after(value: string | null): number | undefined {
  if (value === null || !/^\d+$/.test(value)) return undefined;
  const seconds = Number(value);
  return Number.isSafeInteger(seconds) && seconds >= 0 && seconds <= 3600
    ? seconds
    : undefined;
}

function authorization_headers(access_token: string): Record<string, string> {
  return { authorization: `Bearer ${access_token}` };
}

function trim_trailing_slash(value: string): string {
  return value.replace(/\/+$/, "");
}

function encode_text(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function join_bytes(
  chunks: readonly Uint8Array[],
  known_size?: number,
): Uint8Array {
  const result = new Uint8Array(
    known_size ?? chunks.reduce((sum, chunk) => sum + chunk.byteLength, 0),
  );
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

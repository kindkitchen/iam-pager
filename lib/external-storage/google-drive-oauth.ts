import { Effect } from "effect";
import type {
  GAuthService,
  GoogleGAuthServiceResolver,
} from "../auth/google-gauth-strategy.ts";
import type { StorageConnectionCredentials } from "./connection-model.ts";

export const google_drive_provider_id = "google-drive";
export const google_drive_file_scope =
  "https://www.googleapis.com/auth/drive.file";
const identity_scopes = ["openid", "email", "profile"] as const;

export type GoogleDriveOAuthResult<T> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly reason: "provider_failure" };

export interface GoogleDriveOAuthGrant {
  readonly provider_subject: string;
  readonly scopes: readonly string[];
  readonly credentials: StorageConnectionCredentials;
}

export interface GoogleDriveOAuthClient {
  begin(input: {
    readonly state: string;
    readonly callback_url: string;
  }): Promise<
    GoogleDriveOAuthResult<{
      authorization_url: string;
      attempt_context: string;
    }>
  >;
  complete(input: {
    readonly code: string;
    readonly callback_url: string;
    readonly attempt_context: string;
  }): Promise<GoogleDriveOAuthResult<GoogleDriveOAuthGrant>>;
  revoke(credentials: StorageConnectionCredentials): Promise<void>;
}

export interface GoogleDriveTokenRevoker {
  revoke(token: string): Promise<void>;
}

/** gauth adapter registered independently from sign-in. */
export class GoogleDriveGAuthClient implements GoogleDriveOAuthClient {
  readonly #gauth: GAuthService | null;
  readonly #service_resolver: GoogleGAuthServiceResolver | null;
  readonly #token_revoker: GoogleDriveTokenRevoker;

  constructor(options: {
    gauth: GAuthService | null;
    service_resolver?: GoogleGAuthServiceResolver;
    token_revoker: GoogleDriveTokenRevoker;
  }) {
    this.#gauth = options.gauth;
    this.#service_resolver = options.service_resolver ?? null;
    this.#token_revoker = options.token_revoker;
  }

  async begin(input: {
    readonly state: string;
    readonly callback_url: string;
  }): Promise<
    GoogleDriveOAuthResult<{
      authorization_url: string;
      attempt_context: string;
    }>
  > {
    try {
      const gauth = await this.#resolve_service(input.callback_url);
      const result = await Effect.runPromise(gauth.generate_sign_in_url({
        scope: [...identity_scopes, google_drive_file_scope],
        state: input.state,
        redirect_uri: input.callback_url,
      }));
      const authorization_url = new URL(result.authorization_url);
      authorization_url.searchParams.set("access_type", "offline");
      authorization_url.searchParams.set("prompt", "consent");
      return {
        ok: true,
        value: {
          authorization_url: authorization_url.href,
          attempt_context: result.ctx.code_verifier,
        },
      };
    } catch {
      return { ok: false, reason: "provider_failure" };
    }
  }

  async complete(input: {
    readonly code: string;
    readonly callback_url: string;
    readonly attempt_context: string;
  }): Promise<GoogleDriveOAuthResult<GoogleDriveOAuthGrant>> {
    try {
      const gauth = await this.#resolve_service(input.callback_url);
      const result = await Effect.runPromise(gauth.process_callback_payload({
        code: input.code,
        code_verifier: input.attempt_context,
      }));
      if (!result.access_token || !result.user_info.id) {
        return { ok: false, reason: "provider_failure" };
      }
      return {
        ok: true,
        value: {
          provider_subject: result.user_info.id,
          scopes: [google_drive_file_scope],
          credentials: {
            access_token: result.access_token,
            ...(result.refresh_token
              ? { refresh_token: result.refresh_token }
              : {}),
          },
        },
      };
    } catch {
      return { ok: false, reason: "provider_failure" };
    }
  }

  async revoke(credentials: StorageConnectionCredentials): Promise<void> {
    await this.#token_revoker.revoke(
      credentials.refresh_token ?? credentials.access_token,
    );
  }

  #resolve_service(callback_url: string): Promise<GAuthService> {
    if (this.#service_resolver !== null) {
      return this.#service_resolver.resolve(callback_url);
    }
    if (this.#gauth !== null) return Promise.resolve(this.#gauth);
    return Promise.reject(new TypeError("Google Drive gauth unavailable"));
  }
}

export class FetchGoogleDriveTokenRevoker implements GoogleDriveTokenRevoker {
  readonly #fetch: typeof fetch;

  constructor(fetcher: typeof fetch = fetch) {
    this.#fetch = fetcher;
  }

  async revoke(token: string): Promise<void> {
    const response = await this.#fetch("https://oauth2.googleapis.com/revoke", {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ token }),
      redirect: "error",
    });
    if (!response.ok) throw new Error("Google token revocation failed");
  }
}

export class LocalGoogleDriveTokenRevoker implements GoogleDriveTokenRevoker {
  revoke(_token: string): Promise<void> {
    return Promise.resolve();
  }
}

export class UnavailableGoogleDriveOAuthClient
  implements GoogleDriveOAuthClient {
  begin(): Promise<GoogleDriveOAuthResult<never>> {
    return Promise.resolve({ ok: false, reason: "provider_failure" });
  }

  complete(): Promise<GoogleDriveOAuthResult<never>> {
    return Promise.resolve({ ok: false, reason: "provider_failure" });
  }

  revoke(): Promise<void> {
    return Promise.reject(new Error("Google Drive OAuth is unavailable"));
  }
}

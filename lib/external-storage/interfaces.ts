import type {
  ExternalContentFetchInput,
  ExternalContentPayload,
  ExternalContentPutInput,
  ExternalContentRef,
  ExternalContentStat,
  ExternalStorageCapability,
  ExternalStorageResult,
} from "./model.ts";

/**
 * Provider-neutral content custody adapter. Every implementation must pass
 * `test_external_storage_provider_conformance` unchanged.
 */
export interface ExternalStorageProvider {
  readonly provider_id: string;
  /** `read` is mandatory; `write` and `delete` advertise optional methods. */
  readonly capabilities: readonly ExternalStorageCapability[];

  fetch_content(
    input: ExternalContentFetchInput,
  ): Promise<ExternalStorageResult<ExternalContentPayload>>;

  stat_content(
    content_ref: ExternalContentRef,
  ): Promise<ExternalStorageResult<ExternalContentStat>>;

  put_content?(
    input: ExternalContentPutInput,
  ): Promise<ExternalStorageResult<ExternalContentRef>>;

  delete_content?(
    content_ref: ExternalContentRef,
  ): Promise<ExternalStorageResult<void>>;
}

/** Read-only provider selection surface used by application orchestration. */
export interface ExternalStorageProviderResolver {
  resolve(provider_id: string): ExternalStorageProvider | null;
}

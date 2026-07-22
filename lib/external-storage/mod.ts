export type {
  ExternalStorageProvider,
  ExternalStorageProviderResolver,
} from "./interfaces.ts";
export type {
  ExternalContentFetchInput,
  ExternalContentPayload,
  ExternalContentPutInput,
  ExternalContentRef,
  ExternalContentStat,
  ExternalStorageCapability,
  ExternalStorageFailure,
  ExternalStorageResult,
} from "./model.ts";
export {
  external_content_ref_violation,
  external_storage_capabilities,
  has_external_storage_capability,
  is_external_connection_id,
  is_external_content_ref,
  is_external_fetch_bound,
  is_external_provider_id,
  is_external_storage_capability,
  max_external_connection_id_length,
  max_external_provider_id_length,
  max_external_ref_length,
  max_external_version_hint_length,
} from "./model.ts";
export { MemoryExternalStorageProvider } from "./memory-provider.ts";
export {
  type ExternalStorageProviderConformanceFixture,
  type ExternalStorageProviderConformanceOptions,
  test_external_storage_provider_conformance,
} from "./provider-conformance.ts";
export { ExternalStorageProviderRegistry } from "./provider-registry.ts";

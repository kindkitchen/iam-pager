import type {
  ExternalStorageProvider,
  ExternalStorageProviderResolver,
} from "./interfaces.ts";
import {
  is_external_provider_id,
  is_external_storage_capability,
} from "./model.ts";

/** Immutable-at-composition registry for external storage adapters. */
export class ExternalStorageProviderRegistry
  implements ExternalStorageProviderResolver {
  readonly #providers = new Map<string, ExternalStorageProvider>();

  constructor(providers: readonly ExternalStorageProvider[]) {
    for (const provider of providers) {
      validate_provider(provider);
      if (this.#providers.has(provider.provider_id)) {
        throw new Error(
          `duplicate external storage provider: ${provider.provider_id}`,
        );
      }
      this.#providers.set(provider.provider_id, provider);
    }
  }

  resolve(provider_id: string): ExternalStorageProvider | null {
    return this.#providers.get(provider_id) ?? null;
  }
}

function validate_provider(provider: ExternalStorageProvider): void {
  if (!is_external_provider_id(provider.provider_id)) {
    throw new TypeError(
      `invalid external storage provider ID: ${provider.provider_id}`,
    );
  }

  const capabilities = provider.capabilities as readonly unknown[];
  if (
    capabilities.some((capability) =>
      !is_external_storage_capability(capability)
    )
  ) {
    throw new TypeError(
      `invalid capability for external storage provider: ${provider.provider_id}`,
    );
  }
  if (new Set(capabilities).size !== capabilities.length) {
    throw new TypeError(
      `duplicate capability for external storage provider: ${provider.provider_id}`,
    );
  }
  if (!capabilities.includes("read")) {
    throw new TypeError(
      `external storage provider requires read capability: ${provider.provider_id}`,
    );
  }

  validate_optional_method(provider, "write", "put_content");
  validate_optional_method(provider, "delete", "delete_content");
}

function validate_optional_method(
  provider: ExternalStorageProvider,
  capability: "write" | "delete",
  method: "put_content" | "delete_content",
): void {
  const declared = provider.capabilities.includes(capability);
  const implemented = typeof provider[method] === "function";
  if (declared !== implemented) {
    throw new TypeError(
      `external storage provider capability ${capability} must match ${method}: ${provider.provider_id}`,
    );
  }
}

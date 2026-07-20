import type { DeliveryProfile } from "../content/model.ts";
import { is_valid_delivery_profile } from "../content/model.ts";
import type { Locator, LocatorResolution } from "../locator/model.ts";
import { locator_key } from "../locator/model.ts";

/** One page may expose one canonical and at most seven alternate endpoints. */
export const max_page_endpoints = 8;

/** Stored delivery behavior at one publisher-supplied locator. */
export interface PageEndpointBinding {
  readonly locator: Locator;
  readonly delivery_profile: DeliveryProfile;
}

/**
 * Complete endpoint set for one logical page. The shape makes canonical
 * designation singular instead of relying on independently stored booleans.
 */
export interface PageEndpointSet {
  readonly canonical: PageEndpointBinding;
  /** Deterministically ordered by case-insensitive locator identity. */
  readonly alternates: readonly PageEndpointBinding[];
}

/**
 * First storage-level endpoint-set invariant violation. Locator policy remains
 * the planner's responsibility; persistence enforces only coherent structure,
 * namespace/identity uniqueness, and deterministic ordering.
 */
export function page_endpoint_set_violation(
  endpoint_set: unknown,
): string | null {
  if (
    typeof endpoint_set !== "object" || endpoint_set === null ||
    Array.isArray(endpoint_set)
  ) {
    return "endpoint_set must be an object";
  }
  const candidate = endpoint_set as Record<string, unknown>;
  if (!Array.isArray(candidate.alternates)) {
    return "endpoint alternates must be an array";
  }
  const bindings = [candidate.canonical, ...candidate.alternates];
  if (bindings.length < 1 || bindings.length > max_page_endpoints) {
    return `endpoint set must contain 1-${max_page_endpoints} bindings`;
  }

  const claimed_keys = new Set<string>();
  let namespace_key: string | null = null;
  let previous_alternate_key: string | null = null;
  for (const [index, value] of bindings.entries()) {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return "endpoint binding must be an object";
    }
    const binding = value as Record<string, unknown>;
    if (
      typeof binding.locator !== "object" || binding.locator === null ||
      Array.isArray(binding.locator)
    ) {
      return "endpoint locator must be an object";
    }
    const locator = binding.locator as Record<string, unknown>;
    if (typeof locator.namespace !== "string" || locator.namespace === "") {
      return "endpoint namespace must be non-empty";
    }
    if (
      locator.page_name !== undefined &&
      (typeof locator.page_name !== "string" || locator.page_name === "")
    ) {
      return "endpoint page_name must be non-empty when present";
    }
    if (!is_valid_delivery_profile(binding.delivery_profile)) {
      return "endpoint delivery_profile must be valid";
    }
    const typed_locator = locator as unknown as Locator;
    const current_namespace_key = typed_locator.namespace.toLowerCase();
    namespace_key ??= current_namespace_key;
    if (current_namespace_key !== namespace_key) {
      return "endpoint namespaces must match case-insensitively";
    }
    const key = locator_key(typed_locator);
    if (claimed_keys.has(key)) {
      return "endpoint locators must be unique case-insensitively";
    }
    claimed_keys.add(key);
    if (index > 0) {
      if (
        previous_alternate_key !== null &&
        compare_strings(previous_alternate_key, key) >= 0
      ) {
        return "endpoint alternates must be ordered by locator identity";
      }
      previous_alternate_key = key;
    }
  }
  return null;
}

/** Publisher intent before locator and content-profile policy are applied. */
export interface PageEndpointSetIntent {
  readonly canonical: PageEndpointBinding;
  readonly alternates?: readonly PageEndpointBinding[];
}

/** Minimal locator capability required by endpoint planning. */
export interface PageEndpointLocatorValidator {
  validate(locator: Locator): LocatorResolution;
}

export interface PlanPageEndpointSetRequest {
  readonly endpoint_set: PageEndpointSetIntent;
  /** Non-empty profile set declared by the selected content type. */
  readonly supported_delivery_profiles: readonly DeliveryProfile[];
}

export type PlanPageEndpointSetResult =
  | { readonly ok: true; readonly endpoint_set: PageEndpointSet }
  | {
    readonly ok: false;
    readonly reason:
      | "invalid_endpoint_count"
      | "invalid_locator"
      | "forbidden_namespace"
      | "namespace_mismatch"
      | "duplicate_locator"
      | "unsupported_delivery_profile";
  };

/** Validates and canonicalizes complete endpoint-set intent. */
export interface PageEndpointPlanner {
  plan(request: PlanPageEndpointSetRequest): PlanPageEndpointSetResult;
}

/**
 * Transport/storage-neutral endpoint planner. It validates every locator,
 * requires one namespace and one case-insensitive claim per binding, applies
 * the content type's profile policy, and returns a detached stable set.
 */
export class DefaultPageEndpointPlanner implements PageEndpointPlanner {
  readonly #locator_validator: PageEndpointLocatorValidator;

  constructor(locator_validator: PageEndpointLocatorValidator) {
    this.#locator_validator = locator_validator;
  }

  plan(request: PlanPageEndpointSetRequest): PlanPageEndpointSetResult {
    const supported_profiles = require_supported_profiles(
      request.supported_delivery_profiles,
    );
    const bindings = [
      request.endpoint_set.canonical,
      ...(request.endpoint_set.alternates ?? []),
    ];
    if (bindings.length < 1 || bindings.length > max_page_endpoints) {
      return { ok: false, reason: "invalid_endpoint_count" };
    }

    const canonical_namespace_key = bindings[0].locator.namespace.toLowerCase();
    const claimed_locator_keys = new Set<string>();
    const planned: PageEndpointBinding[] = [];
    for (const binding of bindings) {
      if (
        !is_valid_delivery_profile(binding.delivery_profile) ||
        !supported_profiles.has(binding.delivery_profile)
      ) {
        return { ok: false, reason: "unsupported_delivery_profile" };
      }
      const resolution = this.#locator_validator.validate(binding.locator);
      if (!resolution.ok) {
        return {
          ok: false,
          reason: resolution.reason === "forbidden_namespace"
            ? "forbidden_namespace"
            : "invalid_locator",
        };
      }
      if (binding.locator.namespace.toLowerCase() !== canonical_namespace_key) {
        return { ok: false, reason: "namespace_mismatch" };
      }
      const key = locator_key(binding.locator);
      if (claimed_locator_keys.has(key)) {
        return { ok: false, reason: "duplicate_locator" };
      }
      claimed_locator_keys.add(key);
      planned.push({
        locator: { ...binding.locator },
        delivery_profile: binding.delivery_profile,
      });
    }

    const [canonical, ...alternates] = planned;
    alternates.sort((left, right) =>
      compare_strings(locator_key(left.locator), locator_key(right.locator))
    );
    return { ok: true, endpoint_set: { canonical, alternates } };
  }
}

function require_supported_profiles(
  profiles: readonly DeliveryProfile[],
): Set<DeliveryProfile> {
  if (profiles.length === 0) {
    throw new Error("endpoint planner: supported profiles must be non-empty");
  }
  const supported = new Set<DeliveryProfile>();
  for (const profile of profiles) {
    if (!is_valid_delivery_profile(profile) || supported.has(profile)) {
      throw new Error(
        "endpoint planner: supported profiles must be valid and unique",
      );
    }
    supported.add(profile);
  }
  return supported;
}

function compare_strings(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}

import type { DeliveryProfile } from "../content/model.ts";
import { is_valid_delivery_profile } from "../content/model.ts";
import type { Locator, LocatorResolution } from "../locator/model.ts";
import { locator_key } from "../locator/model.ts";

/**
 * Legacy site advisory matching the current Deno KV atomic-write capacity.
 * This is not a domain cardinality rule: endpoint sets are logically non-empty.
 * @deprecated Site-only constraint retained until the UI projection is revised.
 */
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

/** Safe application-relative link for one stored delivery binding. */
export interface PageEndpointLink extends PageEndpointBinding {
  readonly path: string;
}

/** Complete link projection that preserves the singular canonical endpoint. */
export interface PageEndpointLinks {
  readonly canonical: PageEndpointLink;
  readonly alternates: readonly PageEndpointLink[];
}

/** Minimal locator formatting capability required by endpoint projection. */
export interface PageEndpointPathFormatter {
  format(locator: Locator): string;
}

/** True only for an app-relative direct path that cannot become an external URL. */
export function is_safe_page_path(value: unknown): value is string {
  if (
    typeof value !== "string" || !value.startsWith("/") ||
    value.startsWith("//")
  ) {
    return false;
  }
  for (const character of value) {
    const code = character.charCodeAt(0);
    if (
      code <= 0x1f || code === 0x7f || character === "\\" ||
      character === "?" || character === "#"
    ) {
      return false;
    }
  }
  return true;
}

/**
 * Maps one complete stored set to detached safe links. URL formatting stays at
 * the locator boundary; callers never infer endpoint behavior from a suffix.
 */
export function project_page_endpoint_links(
  endpoint_set: PageEndpointSet,
  formatter: PageEndpointPathFormatter,
): PageEndpointLinks {
  const violation = page_endpoint_set_violation(endpoint_set);
  if (violation !== null) {
    throw new Error(`endpoint link projection: ${violation}`);
  }
  const project = (binding: PageEndpointBinding): PageEndpointLink => {
    const path = formatter.format(binding.locator);
    if (!is_safe_page_path(path)) {
      throw new Error(
        "endpoint link projection: formatter produced unsafe path",
      );
    }
    return {
      locator: structuredClone(binding.locator),
      path,
      delivery_profile: binding.delivery_profile,
    };
  };
  return {
    canonical: project(endpoint_set.canonical),
    alternates: endpoint_set.alternates.map(project),
  };
}

/**
 * First storage-level endpoint-set invariant violation. Locator policy remains
 * the planner's responsibility; persistence enforces coherent non-empty
 * structure, identity uniqueness, and deterministic ordering. Endpoint count
 * and namespace grouping are not content invariants.
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
  if (!Object.hasOwn(candidate, "canonical")) {
    return "endpoint set must contain a canonical binding";
  }
  if (!Array.isArray(candidate.alternates)) {
    return "endpoint alternates must be an array";
  }
  const bindings = [candidate.canonical, ...candidate.alternates];

  const claimed_keys = new Set<string>();
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
      | "invalid_locator"
      | "forbidden_namespace"
      | "duplicate_locator"
      | "unsupported_delivery_profile";
  };

/** Validates and canonicalizes complete endpoint-set intent. */
export interface PageEndpointPlanner {
  plan(request: PlanPageEndpointSetRequest): PlanPageEndpointSetResult;
}

/**
 * Transport/storage-neutral endpoint planner. It validates every locator,
 * requires one case-insensitive claim per binding, applies the content type's
 * profile policy, and returns a detached stable set. Namespace authority is an
 * application concern and is checked for every accepted binding.
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

import type { DeliveryProfile } from "../content/model.ts";
import { prefixed, strict_object } from "../http/strict-object.ts";
import type { Locator } from "../locator/model.ts";
import type { PageEndpointBinding, PageEndpointSetIntent } from "./endpoint.ts";

export type PageEndpointJsonDecodeResult<Value> =
  | { readonly ok: true; readonly value: Value }
  | { readonly ok: false; readonly detail: string };

/**
 * Decodes transport JSON into endpoint intent without applying locator,
 * authority, delivery-profile, or content-format policy. Those rules remain in
 * the application planner.
 */
export function decode_page_endpoint_set_intent(
  input: unknown,
): PageEndpointJsonDecodeResult<PageEndpointSetIntent> {
  const set = strict_object(input, ["canonical", "alternates?"]);
  if (!set.ok) return prefixed(set, "endpoint_set");
  if (
    set.value.alternates !== undefined &&
    !Array.isArray(set.value.alternates)
  ) {
    return { ok: false, detail: "endpoint_set.alternates must be an array" };
  }
  const canonical = decode_page_endpoint_binding(set.value.canonical);
  if (!canonical.ok) return prefixed(canonical, "endpoint_set.canonical");
  const alternates: PageEndpointBinding[] = [];
  for (const [index, value] of (set.value.alternates ?? []).entries()) {
    const decoded = decode_page_endpoint_binding(value);
    if (!decoded.ok) {
      return prefixed(decoded, `endpoint_set.alternates[${index}]`);
    }
    alternates.push(decoded.value);
  }
  return {
    ok: true,
    value: { canonical: canonical.value, alternates },
  };
}

function decode_page_endpoint_binding(
  input: unknown,
): PageEndpointJsonDecodeResult<PageEndpointBinding> {
  const binding = strict_object(input, ["locator", "delivery_profile"]);
  if (!binding.ok) return binding;
  const locator = strict_object(binding.value.locator, [
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
  if (typeof binding.value.delivery_profile !== "string") {
    return { ok: false, detail: "delivery_profile must be a string" };
  }
  const typed_locator: Locator = locator.value.page_name === undefined
    ? { namespace: locator.value.namespace }
    : {
      namespace: locator.value.namespace,
      page_name: locator.value.page_name,
    };
  return {
    ok: true,
    value: {
      locator: typed_locator,
      delivery_profile: binding.value.delivery_profile as DeliveryProfile,
    },
  };
}

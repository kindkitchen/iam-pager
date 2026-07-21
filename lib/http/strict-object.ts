export type StrictObjectResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; detail: string };

/** Decode an object whose `?`-suffixed field declarations are optional. */
export function strict_object(
  input: unknown,
  fields: readonly string[],
): StrictObjectResult {
  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    return { ok: false, detail: "value must be an object" };
  }
  const value = input as Record<string, unknown>;
  const required = fields.filter((field) => !field.endsWith("?"));
  const allowed = fields.map((field) => field.replace(/\?$/, ""));
  const unknown = Object.keys(value).find((field) => !allowed.includes(field));
  if (unknown !== undefined) {
    return { ok: false, detail: `unknown field: ${unknown}` };
  }
  const missing = required.find((field) => !Object.hasOwn(value, field));
  return missing === undefined
    ? { ok: true, value }
    : { ok: false, detail: `missing field: ${missing}` };
}

export function prefixed(
  failure: { readonly ok: false; readonly detail: string },
  prefix: string,
): { readonly ok: false; readonly detail: string } {
  return { ok: false, detail: `${prefix}: ${failure.detail}` };
}

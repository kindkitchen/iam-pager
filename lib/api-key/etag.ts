import { is_valid_api_key_id } from "./model.ts";

export interface ApiKeyEtag {
  readonly api_key_id: string;
  readonly revision: number;
}

const api_key_etag_pattern = /^"api-key-([A-Za-z0-9_-]{1,64})-r([1-9][0-9]*)"$/;

/** Strong validator for one API-key metadata representation. */
export function format_api_key_etag(
  api_key_id: string,
  revision: number,
): string {
  if (
    !is_valid_api_key_id(api_key_id) || !Number.isSafeInteger(revision) ||
    revision < 1
  ) {
    throw new Error("cannot format an invalid API-key ETag");
  }
  return `"api-key-${api_key_id}-r${revision}"`;
}

/**
 * Parse exactly one strong API-key ETag. Weak validators, wildcards, lists,
 * whitespace, padded revisions, and invalid IDs are rejected.
 */
export function parse_api_key_etag(value: string | null): ApiKeyEtag | null {
  if (value === null) return null;
  const match = api_key_etag_pattern.exec(value);
  if (match === null) return null;
  const revision = Number(match[2]);
  if (!Number.isSafeInteger(revision)) return null;
  return { api_key_id: match[1], revision };
}

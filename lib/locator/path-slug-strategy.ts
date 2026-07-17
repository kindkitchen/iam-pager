import type { Locator, LocatorResolution } from "./model.ts";
import type { LocatorStrategy } from "./strategy.ts";

/**
 * First strategy (DA-LOCATOR mapping choice): the first path slug is the
 * namespace and everything after it — even across many slugs — is the page
 * name.
 */
export class PathSlugStrategy implements LocatorStrategy {
  readonly strategy_name = "path-slug";

  resolve(pathname: string): LocatorResolution {
    const raw_segments = pathname.split("/").filter((s) => s !== "");
    if (raw_segments.length === 0) {
      return { ok: false, reason: "not_a_locator" };
    }
    const segments: string[] = [];
    for (const raw of raw_segments) {
      let decoded: string;
      try {
        decoded = decodeURIComponent(raw);
      } catch {
        return { ok: false, reason: "invalid_segment" };
      }
      if (decoded === "." || decoded === ".." || decoded.includes("/")) {
        return { ok: false, reason: "invalid_segment" };
      }
      segments.push(decoded);
    }
    const [namespace, ...page_segments] = segments;
    const locator: Locator = page_segments.length === 0
      ? { namespace }
      : { namespace, page_name: page_segments.join("/") };
    return { ok: true, locator };
  }

  format(locator: Locator): string {
    const segments = [
      locator.namespace,
      ...(locator.page_name?.split("/") ?? []),
    ];
    return "/" + segments.map(encodeURIComponent).join("/");
  }
}

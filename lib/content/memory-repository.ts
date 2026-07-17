import { type Locator, locator_key } from "../locator/model.ts";
import type { ContentRepository } from "./interfaces.ts";
import type { PageRecord } from "./model.ts";

/**
 * Map-backed repository for the guest slice: no durability promised
 * (001.draft), case-insensitive identity enforced by deriving keys via
 * `locator_key`, original locator casing preserved in the stored record.
 */
export class MemoryContentRepository implements ContentRepository {
  #pages = new Map<string, PageRecord>();

  get(locator: Locator): Promise<PageRecord | null> {
    return Promise.resolve(this.#pages.get(locator_key(locator)) ?? null);
  }

  put(page: PageRecord): Promise<void> {
    this.#pages.set(locator_key(page.locator), page);
    return Promise.resolve();
  }

  delete(locator: Locator): Promise<boolean> {
    return Promise.resolve(this.#pages.delete(locator_key(locator)));
  }
}

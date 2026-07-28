/**
 * Persistence seam for the step editor configuration.
 *
 * The editor never talks to a storage API directly: it reads and writes one
 * JSON-serializable {@link StepEditorConfig} through this contract. Today the
 * browser implementation keeps the choice across renders and sessions in web
 * storage; a per-user server profile can replace it later without touching the
 * editor.
 */
import {
  normalize_step_editor_config,
  type StepEditorConfig,
} from "./step-editor-config.ts";

export interface StepEditorConfigStore {
  /** Never throws: unusable storage yields the normalized defaults. */
  load(): StepEditorConfig;
  save(config: StepEditorConfig): void;
}

export const step_editor_config_storage_key = "iam-pager.step-editor-config";

/** In-memory store, also used as the fallback when storage is unavailable. */
export class MemoryStepEditorConfigStore implements StepEditorConfigStore {
  #config: StepEditorConfig;

  constructor(initial?: unknown) {
    this.#config = normalize_step_editor_config(initial);
  }

  load(): StepEditorConfig {
    return this.#config;
  }

  save(config: StepEditorConfig): void {
    this.#config = normalize_step_editor_config(config);
  }
}

/** Web-storage store; any `Storage`-shaped object satisfies the dependency. */
export class WebStorageStepEditorConfigStore implements StepEditorConfigStore {
  constructor(
    private readonly storage: Pick<Storage, "getItem" | "setItem">,
    private readonly key: string = step_editor_config_storage_key,
  ) {}

  load(): StepEditorConfig {
    try {
      const raw = this.storage.getItem(this.key);
      return normalize_step_editor_config(
        raw === null ? null : JSON.parse(raw),
      );
    } catch {
      return normalize_step_editor_config(null);
    }
  }

  save(config: StepEditorConfig): void {
    try {
      this.storage.setItem(this.key, JSON.stringify(config));
    } catch {
      // A full or blocked storage must never break editing.
    }
  }
}

/**
 * Store for the current runtime: web storage in a browser, memory anywhere
 * else (server rendering, tests).
 */
export function step_editor_config_store(): StepEditorConfigStore {
  try {
    const storage = globalThis.localStorage;
    if (storage) return new WebStorageStepEditorConfigStore(storage);
  } catch {
    // Storage access can be denied outright; fall through to memory.
  }
  return new MemoryStepEditorConfigStore();
}

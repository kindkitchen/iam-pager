import { assertEquals } from "@std/assert";
import {
  default_step_editor_config,
  enabled_step_inputs,
  link_variant_map,
  link_variant_simple,
  map_route_enabled,
  normalize_step_editor_config,
  set_step_input_enabled,
  set_step_input_variant,
  step_input_variant,
} from "./step-editor-config.ts";
import {
  MemoryStepEditorConfigStore,
  step_editor_config_storage_key,
  WebStorageStepEditorConfigStore,
} from "./step-editor-config-store.ts";

Deno.test("the default configuration offers every input, link with the map variant", () => {
  const config = default_step_editor_config();
  assertEquals(enabled_step_inputs(config), [
    "text",
    "heading",
    "link",
    "code-block",
    "raw",
  ]);
  assertEquals(map_route_enabled(config), true);
});

Deno.test("a configuration round-trips through JSON unchanged", () => {
  const config = set_step_input_variant(
    set_step_input_enabled(default_step_editor_config(), "code-block", false),
    "link",
    link_variant_simple,
  );
  const restored = normalize_step_editor_config(
    JSON.parse(JSON.stringify(config)),
  );
  assertEquals(restored, config);
  assertEquals(map_route_enabled(restored), false);
});

Deno.test("unknown, partial, and broken stored values normalize to defaults", () => {
  const defaults = default_step_editor_config();
  for (const stored of [null, 42, "x", {}, { inputs: "no" }, { inputs: {} }]) {
    assertEquals(normalize_step_editor_config(stored), defaults);
  }
  const partial = normalize_step_editor_config({
    inputs: {
      link: { enabled: false, variant: "nonsense" },
      unknown_input: { enabled: true },
    },
  });
  assertEquals(partial.inputs.link.enabled, false);
  assertEquals(partial.inputs.link.variant, link_variant_map);
  assertEquals(Object.keys(partial.inputs).includes("unknown_input"), false);
  assertEquals(partial.inputs.heading.enabled, true);
});

Deno.test("the text input can never be switched off", () => {
  const config = set_step_input_enabled(
    default_step_editor_config(),
    "text",
    false,
  );
  assertEquals(enabled_step_inputs(config).includes("text"), true);
  assertEquals(
    normalize_step_editor_config({ inputs: { text: { enabled: false } } })
      .inputs.text.enabled,
    true,
  );
});

Deno.test("disabling an input removes it from the offered set", () => {
  const config = set_step_input_enabled(
    set_step_input_enabled(default_step_editor_config(), "raw", false),
    "heading",
    false,
  );
  assertEquals(enabled_step_inputs(config), ["text", "link", "code-block"]);
});

Deno.test("only known variants are stored", () => {
  const config = set_step_input_variant(
    default_step_editor_config(),
    "link",
    "nonsense",
  );
  assertEquals(step_input_variant(config, "link"), link_variant_map);
  assertEquals(
    step_input_variant(
      set_step_input_variant(config, "link", link_variant_simple),
      "link",
    ),
    link_variant_simple,
  );
});

Deno.test("the memory store keeps the last saved configuration", () => {
  const store = new MemoryStepEditorConfigStore();
  assertEquals(store.load(), default_step_editor_config());
  const config = set_step_input_enabled(store.load(), "raw", false);
  store.save(config);
  assertEquals(store.load(), config);
});

Deno.test("the web-storage store survives absent and broken entries", () => {
  const entries = new Map<string, string>();
  const storage = {
    getItem: (key: string) => entries.get(key) ?? null,
    setItem: (key: string, value: string) => void entries.set(key, value),
  };
  const store = new WebStorageStepEditorConfigStore(storage);

  assertEquals(store.load(), default_step_editor_config());
  const config = set_step_input_variant(
    default_step_editor_config(),
    "link",
    link_variant_simple,
  );
  store.save(config);
  assertEquals(
    JSON.parse(entries.get(step_editor_config_storage_key)!),
    config,
  );
  assertEquals(store.load(), config);

  entries.set(step_editor_config_storage_key, "{not json");
  assertEquals(store.load(), default_step_editor_config());
});

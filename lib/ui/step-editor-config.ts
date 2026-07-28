/**
 * Configuration of the Markdown step editor: which step inputs the editor
 * offers, and which variant of an input is in use.
 *
 * The whole configuration is a plain JSON value on purpose. It is the seam for
 * a future per-user UI memory: any store — component state, web storage, a
 * server profile — can hand back an unknown JSON blob, `normalize` turns it
 * into a valid configuration, and the editor uses it as its initial state.
 * Nothing here knows about Preact, the DOM, or Markdown itself.
 */

export const step_input_ids = [
  "text",
  "heading",
  "link",
  "code-block",
  "raw",
] as const;

export type StepInputId = typeof step_input_ids[number];

/** Variant of one input, rendered as a select next to its checkbox. */
export interface StepInputVariantDescriptor {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
}

export interface StepInputDescriptor {
  readonly id: StepInputId;
  readonly label: string;
  /** Empty when the input has a single behaviour. */
  readonly variants: readonly StepInputVariantDescriptor[];
  readonly default_variant: string;
  readonly default_enabled: boolean;
  /** The editor always keeps one plain input, so it can never be emptied. */
  readonly always_enabled: boolean;
}

/** Link variants: plain label/URL, or the same plus Google Maps stops. */
export const link_variant_simple = "simple";
export const link_variant_map = "map";

export const step_input_descriptors: readonly StepInputDescriptor[] = [
  {
    id: "text",
    label: "Text",
    variants: [],
    default_variant: "",
    default_enabled: true,
    always_enabled: true,
  },
  {
    id: "heading",
    label: "Heading",
    variants: [],
    default_variant: "",
    default_enabled: true,
    always_enabled: false,
  },
  {
    id: "link",
    label: "Link",
    variants: [
      {
        id: link_variant_simple,
        label: "Simple",
        hint: "Label and URL only.",
      },
      {
        id: link_variant_map,
        label: "Simple + Map route",
        hint:
          "Adds Google Maps stops to a link whose URL is a Maps place or route.",
      },
    ],
    default_variant: link_variant_map,
    default_enabled: true,
    always_enabled: false,
  },
  {
    id: "code-block",
    label: "Code block",
    variants: [],
    default_variant: "",
    default_enabled: true,
    always_enabled: false,
  },
  {
    id: "raw",
    label: "Raw Markdown",
    variants: [],
    default_variant: "",
    default_enabled: true,
    always_enabled: false,
  },
];

/** One input's stored state. */
export interface StepInputSetting {
  readonly enabled: boolean;
  readonly variant: string;
}

/** Whole editor configuration; serializes to JSON as-is. */
export interface StepEditorConfig {
  readonly version: 1;
  readonly inputs: Readonly<Record<StepInputId, StepInputSetting>>;
}

export const step_editor_config_version = 1;

/**
 * Reading and updating the configuration. Implementations stay pure: every
 * update returns a new JSON-serializable configuration.
 */
export interface StepEditorPreferences {
  defaults(): StepEditorConfig;
  /** Accepts anything a store may return, including `null` or partial JSON. */
  normalize(value: unknown): StepEditorConfig;
  set_enabled(
    config: StepEditorConfig,
    id: StepInputId,
    enabled: boolean,
  ): StepEditorConfig;
  set_variant(
    config: StepEditorConfig,
    id: StepInputId,
    variant: string,
  ): StepEditorConfig;
  is_enabled(config: StepEditorConfig, id: StepInputId): boolean;
  variant(config: StepEditorConfig, id: StepInputId): string;
  enabled_inputs(config: StepEditorConfig): readonly StepInputId[];
}

function descriptor_of(id: StepInputId): StepInputDescriptor {
  const descriptor = step_input_descriptors.find((entry) => entry.id === id);
  if (!descriptor) throw new RangeError(`Unknown step input ${id}`);
  return descriptor;
}

function known_variant(
  descriptor: StepInputDescriptor,
  value: unknown,
): string {
  if (descriptor.variants.length === 0) return "";
  return descriptor.variants.some((variant) => variant.id === value)
    ? value as string
    : descriptor.default_variant;
}

function record_of(
  read: (descriptor: StepInputDescriptor) => StepInputSetting,
): Readonly<Record<StepInputId, StepInputSetting>> {
  const inputs = {} as Record<StepInputId, StepInputSetting>;
  for (const descriptor of step_input_descriptors) {
    inputs[descriptor.id] = read(descriptor);
  }
  return inputs;
}

export function default_step_editor_config(): StepEditorConfig {
  return {
    version: step_editor_config_version,
    inputs: record_of((descriptor) => ({
      enabled: descriptor.default_enabled,
      variant: descriptor.default_variant,
    })),
  };
}

/**
 * Turns stored JSON into a usable configuration: unknown inputs and variants
 * are dropped, missing ones fall back to their default, and an input that can
 * never be disabled stays enabled.
 */
export function normalize_step_editor_config(value: unknown): StepEditorConfig {
  const source = typeof value === "object" && value !== null
    ? (value as { inputs?: unknown }).inputs
    : undefined;
  const stored = typeof source === "object" && source !== null
    ? source as Record<string, unknown>
    : {};

  return {
    version: step_editor_config_version,
    inputs: record_of((descriptor) => {
      const entry = stored[descriptor.id];
      const setting = typeof entry === "object" && entry !== null
        ? entry as { enabled?: unknown; variant?: unknown }
        : {};
      const enabled = descriptor.always_enabled
        ? true
        : typeof setting.enabled === "boolean"
        ? setting.enabled
        : descriptor.default_enabled;
      return { enabled, variant: known_variant(descriptor, setting.variant) };
    }),
  };
}

export function is_step_input_enabled(
  config: StepEditorConfig,
  id: StepInputId,
): boolean {
  return descriptor_of(id).always_enabled || config.inputs[id].enabled;
}

export function step_input_variant(
  config: StepEditorConfig,
  id: StepInputId,
): string {
  return known_variant(descriptor_of(id), config.inputs[id].variant);
}

export function set_step_input_enabled(
  config: StepEditorConfig,
  id: StepInputId,
  enabled: boolean,
): StepEditorConfig {
  const descriptor = descriptor_of(id);
  const next = descriptor.always_enabled ? true : enabled;
  if (config.inputs[id].enabled === next) return config;
  return {
    ...config,
    inputs: { ...config.inputs, [id]: { ...config.inputs[id], enabled: next } },
  };
}

export function set_step_input_variant(
  config: StepEditorConfig,
  id: StepInputId,
  variant: string,
): StepEditorConfig {
  const next = known_variant(descriptor_of(id), variant);
  if (config.inputs[id].variant === next) return config;
  return {
    ...config,
    inputs: { ...config.inputs, [id]: { ...config.inputs[id], variant: next } },
  };
}

/** Inputs the editor may offer, in declaration order. */
export function enabled_step_inputs(
  config: StepEditorConfig,
): readonly StepInputId[] {
  return step_input_descriptors
    .filter((descriptor) => is_step_input_enabled(config, descriptor.id))
    .map((descriptor) => descriptor.id);
}

/** True when link steps also offer the Google Maps stop frame. */
export function map_route_enabled(config: StepEditorConfig): boolean {
  return is_step_input_enabled(config, "link") &&
    step_input_variant(config, "link") === link_variant_map;
}

/** Default implementation of the preferences contract. */
export const step_editor_preferences: StepEditorPreferences = {
  defaults: default_step_editor_config,
  normalize: normalize_step_editor_config,
  set_enabled: set_step_input_enabled,
  set_variant: set_step_input_variant,
  is_enabled: is_step_input_enabled,
  variant: step_input_variant,
  enabled_inputs: enabled_step_inputs,
};

import {
  is_step_input_enabled,
  set_step_input_enabled,
  set_step_input_variant,
  step_input_descriptors,
  step_input_variant,
  type StepEditorConfig,
} from "../lib/ui/step-editor-config.ts";

export interface MarkdownStepExtensionsProps {
  readonly config: StepEditorConfig;
  readonly on_change: (config: StepEditorConfig) => void;
}

/**
 * Heading line of the step editor: one checkbox per available step input, and
 * a select in front of which the checkbox sits whenever an input has more than
 * one behaviour (a Link is Simple, or Simple + Map route).
 */
export function MarkdownStepExtensions(props: MarkdownStepExtensionsProps) {
  return (
    <div class="markdown-step-extensions">
      <span
        class="markdown-step-extensions-label"
        id="markdown-extensions-label"
      >
        Step inputs
      </span>
      <div
        class="markdown-step-extension-list"
        role="group"
        aria-labelledby="markdown-extensions-label"
      >
        {step_input_descriptors.map((descriptor) => {
          const enabled = is_step_input_enabled(props.config, descriptor.id);
          const variant = step_input_variant(props.config, descriptor.id);
          const selected = descriptor.variants.find((entry) =>
            entry.id === variant
          );
          return (
            <span class="markdown-step-extension" key={descriptor.id}>
              <label
                class="markdown-step-extension-toggle"
                for={`step-input-${descriptor.id}`}
              >
                <input
                  id={`step-input-${descriptor.id}`}
                  type="checkbox"
                  checked={enabled}
                  disabled={descriptor.always_enabled}
                  onChange={(event) =>
                    props.on_change(
                      set_step_input_enabled(
                        props.config,
                        descriptor.id,
                        event.currentTarget.checked,
                      ),
                    )}
                />
                <span>{descriptor.label}</span>
              </label>
              {descriptor.variants.length > 1 && (
                <select
                  class="markdown-step-extension-variant"
                  aria-label={`${descriptor.label} behaviour`}
                  title={selected?.hint}
                  value={variant}
                  disabled={!enabled}
                  onChange={(event) =>
                    props.on_change(
                      set_step_input_variant(
                        props.config,
                        descriptor.id,
                        event.currentTarget.value,
                      ),
                    )}
                >
                  {descriptor.variants.map((entry) => (
                    <option value={entry.id} key={entry.id}>
                      {entry.label}
                    </option>
                  ))}
                </select>
              )}
            </span>
          );
        })}
      </div>
    </div>
  );
}

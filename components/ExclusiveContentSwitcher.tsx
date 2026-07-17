export interface ExclusiveContentOption<Value extends string> {
  readonly value: Value;
  readonly label: string;
  readonly button_id: string;
  readonly panel_id: string;
}

export interface ExclusiveContentSwitcherProps<Value extends string> {
  readonly aria_label: string;
  readonly value: Value;
  readonly options: readonly ExclusiveContentOption<Value>[];
  readonly class_name?: string;
  readonly on_select: (value: Value) => void;
}

/** Visually attaches exclusive interchangeable-content choices to their panel. */
export function ExclusiveContentSwitcher<Value extends string>(
  props: ExclusiveContentSwitcherProps<Value>,
) {
  const class_name = props.class_name
    ? `exclusive-content-switcher ${props.class_name}`
    : "exclusive-content-switcher";

  return (
    <div class={class_name} role="group" aria-label={props.aria_label}>
      {props.options.map((option) => (
        <button
          key={option.value}
          id={option.button_id}
          type="button"
          class="exclusive-content-button"
          aria-controls={option.panel_id}
          aria-pressed={props.value === option.value}
          onClick={() => props.on_select(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

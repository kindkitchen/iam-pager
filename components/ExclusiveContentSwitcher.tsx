import type { JSX } from "preact";

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
  readonly on_select: (value: Value) => boolean | void;
}

/** Visually attaches exclusive interchangeable-content choices to their panel. */
export function ExclusiveContentSwitcher<Value extends string>(
  props: ExclusiveContentSwitcherProps<Value>,
) {
  const class_name = props.class_name
    ? `exclusive-content-switcher ${props.class_name}`
    : "exclusive-content-switcher";

  function select(value: Value): boolean {
    return props.on_select(value) !== false;
  }

  function focus_button(button_id: string) {
    globalThis.requestAnimationFrame(() =>
      globalThis.document.getElementById(button_id)?.focus()
    );
  }

  function select_from_keyboard(
    event: JSX.TargetedKeyboardEvent<HTMLButtonElement>,
    index: number,
  ) {
    let next_index: number;
    switch (event.key) {
      case "ArrowLeft":
      case "ArrowUp":
        next_index = (index - 1 + props.options.length) % props.options.length;
        break;
      case "ArrowRight":
      case "ArrowDown":
        next_index = (index + 1) % props.options.length;
        break;
      case "Home":
        next_index = 0;
        break;
      case "End":
        next_index = props.options.length - 1;
        break;
      default:
        return;
    }

    event.preventDefault();
    const option = props.options[next_index];
    if (select(option.value)) focus_button(option.button_id);
  }

  return (
    <div class={class_name} role="tablist" aria-label={props.aria_label}>
      {props.options.map((option, index) => {
        const selected = props.value === option.value;
        return (
          <button
            key={option.value}
            id={option.button_id}
            type="button"
            role="tab"
            class="exclusive-content-button"
            aria-controls={option.panel_id}
            aria-selected={selected}
            tabIndex={selected ? 0 : -1}
            onClick={() => {
              if (!select(option.value)) {
                const selected_option = props.options.find((candidate) =>
                  candidate.value === props.value
                );
                if (selected_option) focus_button(selected_option.button_id);
              }
            }}
            onKeyDown={(event) => select_from_keyboard(event, index)}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

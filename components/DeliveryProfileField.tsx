import type { DeliveryProfile } from "../lib/content/model.ts";
import { pdf_delivery_profile_options } from "../lib/ui/page-content-type.ts";

export interface DeliveryProfileFieldProps {
  /** Unique radio-group name; one group per reference row. */
  readonly name: string;
  readonly value: DeliveryProfile;
  readonly on_change: (delivery_profile: DeliveryProfile) => void;
  readonly legend?: string;
  readonly disabled?: boolean;
}

/**
 * Explicit delivery selection for one reference. The profile is chosen, never
 * derived from a suffix or alias position, so both options stay visible.
 */
export function DeliveryProfileField(
  { name, value, on_change, legend = "Delivery", disabled }:
    DeliveryProfileFieldProps,
) {
  return (
    <fieldset class="choice-group delivery-profile-field">
      <legend>{legend}</legend>
      <div class="choice-options choice-options-inline">
        {pdf_delivery_profile_options.map((option) => (
          <label class="choice-option" key={option.value}>
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={value === option.value}
              disabled={disabled}
              onChange={() =>
                on_change(option.value)}
            />
            <span>
              <strong>{option.label}</strong>
              <small>{option.description}</small>
            </span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}

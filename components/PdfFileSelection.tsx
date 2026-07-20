import type { JSX } from "preact";
import type { PdfFileSelectionView } from "../lib/ui/pdf-file-selection.ts";

export interface PdfFileSelectionProps {
  readonly view: PdfFileSelectionView;
  readonly name?: string;
  readonly input_id?: string;
  readonly label?: string;
  readonly required?: boolean;
  /** Island hook receiving the chosen file (or null when cleared). */
  readonly on_select?: (file: File | null) => void;
}

/**
 * Renders a bounded PDF picker with server-independent filename/size feedback.
 * Client checks shown here are advisory; the component neither validates bytes
 * nor decides acceptance. It only surfaces the presenter's view and reports the
 * picked file back to its owner.
 */
export function PdfFileSelection(
  {
    view,
    name = "file",
    input_id = "pdf-file",
    label = "PDF file",
    required = false,
    on_select,
  }: PdfFileSelectionProps,
) {
  const feedback_id = `${input_id}-feedback`;
  const advisory_id = `${input_id}-advisory`;
  const has_advisory = view.advisory !== null;
  const handle_change: JSX.GenericEventHandler<HTMLInputElement> = (event) => {
    if (on_select === undefined) return;
    const files = event.currentTarget.files;
    on_select(files !== null && files.length > 0 ? files[0] : null);
  };
  return (
    <div class="pdf-file-selection">
      <label class="pdf-file-selection__label" for={input_id}>{label}</label>
      <input
        id={input_id}
        class="pdf-file-selection__input"
        type="file"
        name={name}
        accept={view.accept}
        required={required}
        aria-describedby={has_advisory
          ? `${feedback_id} ${advisory_id}`
          : feedback_id}
        aria-invalid={has_advisory ? "true" : undefined}
        onChange={handle_change}
      />
      <p
        class="pdf-file-selection__feedback"
        id={feedback_id}
        aria-live="polite"
      >
        {view.has_selection
          ? (
            <span class="pdf-file-selection__selected">
              <span class="pdf-file-selection__filename">{view.filename}</span>
              {view.size_label !== null
                ? (
                  <span class="pdf-file-selection__size">
                    {` (${view.size_label})`}
                  </span>
                )
                : null}
            </span>
          )
          : <span class="pdf-file-selection__empty">{view.hint}</span>}
      </p>
      {has_advisory
        ? (
          <p
            class="pdf-file-selection__advisory"
            id={advisory_id}
            role="alert"
          >
            {view.advisory}
          </p>
        )
        : null}
    </div>
  );
}

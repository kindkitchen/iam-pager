import {
  default_pdf_limits,
  pdf_filename_violation,
  pdf_media_type,
  type PdfLimits,
} from "../content/pdf.ts";

/**
 * Raw attributes a browser reports about a picked file, free of DOM types so
 * the selection logic stays web-independent and reusable by any front-end.
 */
export interface PdfFileCandidate {
  readonly filename: string;
  readonly size_bytes: number;
  /** Browser-reported media type; advisory only, never authoritative. */
  readonly media_type: string;
}

/** Structural shape of a picked file; the DOM `File` type satisfies it. */
export interface PickedFileLike {
  readonly name: string;
  readonly size: number;
  readonly type: string;
}

/** Maps a picked file onto the raw candidate without importing DOM types. */
export function describe_pdf_file(file: PickedFileLike): PdfFileCandidate {
  return {
    filename: file.name,
    size_bytes: file.size,
    media_type: file.type,
  };
}

/** Complete server-independent model the file-selection component renders. */
export interface PdfFileSelectionView {
  readonly has_selection: boolean;
  readonly filename: string | null;
  readonly size_bytes: number | null;
  /** Human-readable size, e.g. "1.4 MiB", or null when nothing is chosen. */
  readonly size_label: string | null;
  readonly media_type: string | null;
  /** First advisory problem with the selection, or null when acceptable. */
  readonly advisory: string | null;
  /** `accept` attribute value the file input should offer. */
  readonly accept: string;
  /** Static guidance naming the accepted file and size ceiling. */
  readonly hint: string;
  /** Upper byte bound echoed for the component and tests. */
  readonly max_bytes: number;
}

/** Builds the file-selection view for a chosen candidate, or the empty state. */
export interface PdfFileSelectionPresenter {
  present(candidate: PdfFileCandidate | null): PdfFileSelectionView;
}

/** `accept` filter offered to the picker; server validation stays authoritative. */
export const pdf_file_accept = "application/pdf,.pdf";

const byte_units = ["B", "KiB", "MiB", "GiB", "TiB"] as const;

/** Formats a byte count into a short human-readable label using binary steps. */
export function format_byte_size(bytes: number): string {
  if (!Number.isSafeInteger(bytes) || bytes < 0) {
    throw new Error("bytes must be a non-negative safe integer");
  }
  let value = bytes;
  let unit = 0;
  while (value >= 1024 && unit < byte_units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const rounded = value >= 10 || unit === 0
    ? Math.round(value)
    : Math.round(value * 10) / 10;
  return `${rounded} ${byte_units[unit]}`;
}

/**
 * First advisory reason the picked file is not obviously publishable, or null.
 * Guidance only: the server re-validates bytes, filename, and media type and
 * remains the sole authority over acceptance.
 */
export function pdf_file_selection_advisory(
  candidate: PdfFileCandidate,
  max_bytes: number = default_pdf_limits.max_bytes,
): string | null {
  if (candidate.size_bytes <= 0) {
    return "selected file is empty";
  }
  if (candidate.size_bytes > max_bytes) {
    return `selected PDF exceeds ${format_byte_size(max_bytes)}`;
  }
  const filename_error = pdf_filename_violation(candidate.filename);
  if (filename_error !== null) {
    return filename_error;
  }
  if (candidate.media_type !== "" && candidate.media_type !== pdf_media_type) {
    return "selected file is not reported as a PDF";
  }
  return null;
}

export interface BoundedPdfFileSelectionPresenterOptions {
  readonly limits?: PdfLimits;
}

/**
 * Keeps size formatting and advisory feedback out of components: the presenter
 * derives filename/size feedback and a bounded advisory hint, while the server
 * remains authoritative over what a valid PDF upload is.
 */
export class BoundedPdfFileSelectionPresenter
  implements PdfFileSelectionPresenter {
  readonly #max_bytes: number;

  constructor(options: BoundedPdfFileSelectionPresenterOptions = {}) {
    const max_bytes = (options.limits ?? default_pdf_limits).max_bytes;
    if (!Number.isSafeInteger(max_bytes) || max_bytes < 1) {
      throw new Error("PDF selection limit must be a positive safe integer");
    }
    this.#max_bytes = max_bytes;
  }

  present(candidate: PdfFileCandidate | null): PdfFileSelectionView {
    const hint = `Choose a PDF up to ${format_byte_size(this.#max_bytes)}.`;
    if (candidate === null) {
      return {
        has_selection: false,
        filename: null,
        size_bytes: null,
        size_label: null,
        media_type: null,
        advisory: null,
        accept: pdf_file_accept,
        hint,
        max_bytes: this.#max_bytes,
      };
    }
    return {
      has_selection: true,
      filename: candidate.filename,
      size_bytes: candidate.size_bytes,
      size_label: format_byte_size(candidate.size_bytes),
      media_type: candidate.media_type,
      advisory: pdf_file_selection_advisory(candidate, this.#max_bytes),
      accept: pdf_file_accept,
      hint,
      max_bytes: this.#max_bytes,
    };
  }
}

export const pdf_file_selection_presenter: PdfFileSelectionPresenter =
  new BoundedPdfFileSelectionPresenter();

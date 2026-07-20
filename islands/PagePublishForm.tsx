import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { PageEditor } from "../components/PageEditor.tsx";
import { PdfFileSelection } from "../components/PdfFileSelection.tsx";
import type { DeliveryProfile } from "../lib/content/model.ts";
import { is_valid_delivery_profile } from "../lib/content/model.ts";
import {
  page_content_type_options,
  type PageContentType,
  pdf_delivery_profile_options,
  pdf_publish_draft_violation,
  prepare_pdf_publish_request,
} from "../lib/ui/page-content-type.ts";
import {
  describe_pdf_file,
  pdf_file_selection_presenter,
} from "../lib/ui/pdf-file-selection.ts";
import {
  page_api_failure_presenter,
  type PageApiFailure,
} from "../lib/ui/page-api-failure.ts";
import {
  page_publish_success_from_api,
  type PagePublishAuthorization,
  type PagePublishSuccess,
  prepare_page_publish_request,
} from "../lib/ui/page-publish.ts";
import { ClientPagePreviewer } from "../lib/ui/page-preview.ts";
import { default_page_style_preset } from "../lib/ui/page-style-presets.ts";
import {
  FourWordRandomNameGenerator,
  type RandomNameGenerator,
} from "../lib/ui/random-name.ts";

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "success"; result: PagePublishSuccess }
  | { status: "error"; failure: PageApiFailure };

const initial_markdown = `# Your page

Write. Style. Preview. Publish.`;

interface PagePublishFormBaseProps {
  /** Generated once on the server so hydration keeps the visible suggestion. */
  initial_namespace: string;
  /** Server-selected initial projection; normal publishing starts in Markdown. */
  initial_content_type?: PageContentType;
}

export interface PagePublishFormProps extends PagePublishFormBaseProps {
  readonly authorization: PagePublishAuthorization;
}

export default function PagePublishForm(props: PagePublishFormProps) {
  const random_name_generator: RandomNameGenerator = useMemo(
    () => new FourWordRandomNameGenerator(),
    [],
  );
  const page_previewer = useMemo(() => new ClientPagePreviewer(), []);
  const [content_type, set_content_type] = useState<PageContentType>(
    props.initial_content_type ?? "md-page",
  );
  const [namespace, set_namespace] = useState(props.initial_namespace);
  const [page_name, set_page_name] = useState("");
  const [markdown, set_markdown] = useState(initial_markdown);
  const [css, set_css] = useState(default_page_style_preset.css);
  const [pdf_file, set_pdf_file] = useState<File | null>(null);
  const [canonical_delivery_profile, set_canonical_delivery_profile] = useState<
    DeliveryProfile
  >("inline");
  const [alternate_namespace, set_alternate_namespace] = useState("");
  const [alternate_page_name, set_alternate_page_name] = useState("");
  const [alternate_delivery_profile, set_alternate_delivery_profile] = useState<
    DeliveryProfile
  >("attachment");
  const [state, set_state] = useState<PublishState>({ status: "idle" });
  const generated_names = useRef(new Set([namespace]));
  const pdf_file_view = useMemo(
    () =>
      pdf_file === null
        ? pdf_file_selection_presenter.present(null)
        : pdf_file_selection_presenter.present(describe_pdf_file(pdf_file)),
    [pdf_file],
  );

  function update_draft(update: () => void) {
    update();
    if (state.status === "success" || state.status === "error") {
      set_state({ status: "idle" });
    }
  }

  function randomize(
    current_value: string,
    set_value: (value: string) => void,
  ) {
    if (current_value !== "") generated_names.current.add(current_value);
    const generated = random_name_generator.generate(generated_names.current);
    generated_names.current.add(generated);
    update_draft(() => set_value(generated));
  }

  function select_content_type(value: PageContentType) {
    update_draft(() => {
      set_content_type(value);
      if (value !== "pdf") set_pdf_file(null);
    });
  }

  function update_delivery_profile(
    value: string,
    set_value: (profile: DeliveryProfile) => void,
  ) {
    if (is_valid_delivery_profile(value)) {
      update_draft(() => set_value(value));
    }
  }

  async function publish(
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    if (content_type === "pdf" && pdf_file === null) {
      set_state({
        status: "error",
        failure: {
          kind: "pdf",
          code: null,
          message: "Select a PDF file to publish.",
        },
      });
      return;
    }

    set_state({ status: "publishing" });
    try {
      let response: Response;
      if (content_type === "md-page") {
        const request = prepare_page_publish_request(
          { namespace, page_name, markdown, css },
          props.authorization,
        );
        response = await fetch("/api/pages", {
          method: "POST",
          headers: request.headers,
          body: JSON.stringify(request.body),
        });
      } else {
        if (pdf_file === null) {
          throw new Error("PDF selection disappeared before publishing");
        }
        const selected_file = pdf_file;
        const draft = {
          filename: selected_file.name,
          bytes: new Uint8Array(await selected_file.arrayBuffer()),
          access: "public" as const,
          canonical: {
            namespace,
            page_name,
            delivery_profile: canonical_delivery_profile,
          },
          alternates: [{
            namespace: alternate_namespace,
            page_name: alternate_page_name,
            delivery_profile: alternate_delivery_profile,
          }],
          tags: [],
        };
        const violation = pdf_publish_draft_violation(draft);
        if (violation !== null) {
          set_state({
            status: "error",
            failure: { kind: "pdf", code: null, message: violation },
          });
          return;
        }
        const request = prepare_pdf_publish_request(
          draft,
          props.authorization,
        );
        response = await fetch(request.url, {
          method: request.method,
          headers: request.headers,
          body: request.form_data,
        });
      }

      const body: unknown = await response.json();
      const result = page_publish_success_from_api(body);
      if (!response.ok || result === null) {
        set_state({
          status: "error",
          failure: page_api_failure_presenter.present(
            response.status,
            body,
            { operation: "publish", content_type },
          ),
        });
        return;
      }
      set_state({ status: "success", result });
    } catch {
      set_state({
        status: "error",
        failure: {
          kind: "availability",
          code: null,
          message: "Page publishing could not be reached. Try again.",
        },
      });
    }
  }

  const is_publishing = state.status === "publishing";
  const is_pdf = content_type === "pdf";
  return (
    <section class="publish-panel" aria-labelledby="publish-heading">
      <div class="section-heading">
        <p class="eyebrow">
          {props.authorization.kind === "creator"
            ? "Creator publishing"
            : "Guest publishing"}
        </p>
        <h2 id="publish-heading">Create a page</h2>
        <p>
          Choose its direct path. A page name is optional; omit it to publish
          the namespace's default page. {props.authorization.kind === "creator"
            ? "Pages in your reserved namespaces are protected."
            : "Guest paths remain unprotected."}
        </p>
      </div>

      <form class="publish-form" onSubmit={publish}>
        <fieldset class="content-type-chooser">
          <legend>Content type</legend>
          <div class="content-type-options">
            {page_content_type_options.map((option) => (
              <label class="content-type-option" key={option.value}>
                <input
                  type="radio"
                  name="content_type"
                  value={option.value}
                  checked={content_type === option.value}
                  onChange={() =>
                    select_content_type(option.value)}
                />
                <span>
                  <strong>{option.label}</strong>
                  <small>{option.description}</small>
                </span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset class="publish-endpoint">
          <legend>{is_pdf ? "Canonical endpoint" : "Page path"}</legend>
          <div class="locator-fields">
            <div class="contextual-input locator-field">
              <div class="contextual-input-heading">
                <label for="namespace">Namespace</label>
                <button
                  type="button"
                  class="embedded-input-action"
                  aria-label="Use a random namespace"
                  onClick={() => randomize(namespace, set_namespace)}
                >
                  Random
                </button>
              </div>
              <input
                id="namespace"
                name="namespace"
                required
                value={namespace}
                onInput={(event) =>
                  update_draft(() => set_namespace(event.currentTarget.value))}
                placeholder="your-name"
                autocomplete="off"
              />
            </div>
            <span class="path-separator" aria-hidden="true">/</span>
            <div class="contextual-input locator-field">
              <div class="contextual-input-heading">
                <label for="page-name">
                  Page name <small>optional</small>
                </label>
                <button
                  type="button"
                  class="embedded-input-action"
                  aria-label="Use a random page name"
                  onClick={() => randomize(page_name, set_page_name)}
                >
                  Random
                </button>
              </div>
              <input
                id="page-name"
                name="page_name"
                value={page_name}
                onInput={(event) =>
                  update_draft(() => set_page_name(event.currentTarget.value))}
                placeholder="notes/today"
                autocomplete="off"
              />
            </div>
          </div>
          {is_pdf && (
            <DeliveryProfileSelect
              input_id="canonical-delivery-profile"
              value={canonical_delivery_profile}
              on_change={(value) =>
                update_delivery_profile(
                  value,
                  set_canonical_delivery_profile,
                )}
            />
          )}
        </fieldset>

        {is_pdf
          ? (
            <div class="pdf-publish-fields">
              <PdfFileSelection
                view={pdf_file_view}
                required
                on_select={(file) => update_draft(() => set_pdf_file(file))}
              />

              <fieldset class="publish-endpoint">
                <legend>Alternate endpoint</legend>
                <p class="field-hint">
                  Configure an ordinary attachment endpoint for direct download.
                  No path suffix is inferred.
                </p>
                <div class="locator-fields">
                  <div class="contextual-input locator-field">
                    <div class="contextual-input-heading">
                      <label for="alternate-namespace">Namespace</label>
                    </div>
                    <input
                      id="alternate-namespace"
                      name="alternate_namespace"
                      required
                      value={alternate_namespace}
                      onInput={(event) =>
                        update_draft(() =>
                          set_alternate_namespace(event.currentTarget.value)
                        )}
                      placeholder="your-name"
                      autocomplete="off"
                    />
                  </div>
                  <span class="path-separator" aria-hidden="true">/</span>
                  <div class="contextual-input locator-field">
                    <div class="contextual-input-heading">
                      <label for="alternate-page-name">
                        Page name <small>optional</small>
                      </label>
                    </div>
                    <input
                      id="alternate-page-name"
                      name="alternate_page_name"
                      value={alternate_page_name}
                      onInput={(event) =>
                        update_draft(() =>
                          set_alternate_page_name(event.currentTarget.value)
                        )}
                      placeholder="report-download"
                      autocomplete="off"
                    />
                  </div>
                </div>
                <DeliveryProfileSelect
                  input_id="alternate-delivery-profile"
                  value={alternate_delivery_profile}
                  on_change={(value) =>
                    update_delivery_profile(
                      value,
                      set_alternate_delivery_profile,
                    )}
                />
              </fieldset>
            </div>
          )
          : (
            <PageEditor
              markdown={markdown}
              css={css}
              on_markdown_input={(value) =>
                update_draft(() => set_markdown(value))}
              on_css_input={(value) =>
                update_draft(() => set_css(value))}
              previewer={page_previewer}
            />
          )}

        <button type="submit" disabled={is_publishing}>
          {is_publishing ? "Publishing…" : "Publish page"}
        </button>
      </form>

      <div class="publish-result" aria-live="polite">
        {state.status === "success" && (
          <>
            <strong>Page published.</strong>
            <a href={state.result.path}>Open {state.result.path}</a>
          </>
        )}
        {state.status === "error" && (
          <p
            class={`error-message page-api-failure-${state.failure.kind}`}
            data-failure-kind={state.failure.kind}
          >
            <strong>Could not publish.</strong> {state.failure.message}
          </p>
        )}
      </div>
    </section>
  );
}

interface DeliveryProfileSelectProps {
  readonly input_id: string;
  readonly value: DeliveryProfile;
  readonly on_change: (value: string) => void;
}

/** Renders explicit profile intent; route shape never chooses delivery. */
function DeliveryProfileSelect(
  { input_id, value, on_change }: DeliveryProfileSelectProps,
) {
  return (
    <label class="delivery-profile-field" for={input_id}>
      Delivery
      <select
        id={input_id}
        name={input_id}
        value={value}
        onChange={(event) => on_change(event.currentTarget.value)}
      >
        {pdf_delivery_profile_options.map((option) => (
          <option value={option.value} key={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  );
}

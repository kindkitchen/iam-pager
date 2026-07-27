import type { JSX } from "preact";
import { useEffect, useMemo, useRef, useState } from "preact/hooks";
import { DeliveryProfileField } from "../components/DeliveryProfileField.tsx";
import { PageEditor } from "../components/PageEditor.tsx";
import { PdfFileSelection } from "../components/PdfFileSelection.tsx";
import type { DeliveryProfile } from "../lib/content/model.ts";
import {
  page_content_type_options,
  type PageContentType,
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
import type { WritableStorageOption } from "../lib/ui/storage-connections.ts";
import {
  page_publish_success_from_api,
  type PagePublishAuthorization,
  type PagePublishReferenceDraft,
  type PagePublishSuccess,
  prepare_page_publish_request,
} from "../lib/ui/page-publish.ts";
import { ClientPagePreviewer } from "../lib/ui/page-preview.ts";
import { default_page_style_preset } from "../lib/ui/page-style-presets.ts";
import {
  FourWordRandomNameGenerator,
  type RandomNameGenerator,
} from "../lib/random-name.ts";
import {
  namespace_reserved_event_type,
  type NamespaceReservedEventDetail,
} from "../lib/ui/namespace-panel.ts";

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "success"; result: PagePublishSuccess }
  | { status: "error"; failure: PageApiFailure };

interface PublishReferenceState {
  readonly id: number;
  readonly namespace: string;
  readonly page_name: string;
  readonly delivery_profile: DeliveryProfile;
}

const initial_markdown = `# Your page

Write. Style. Preview. Publish.`;

interface PagePublishFormBaseProps {
  /** Generated once on the server so hydration keeps the guest suggestion. */
  initial_namespace: string;
  /** Server-selected initial projection; normal publishing starts in Markdown. */
  initial_content_type?: PageContentType;
}

export interface PagePublishFormProps extends PagePublishFormBaseProps {
  readonly authorization: PagePublishAuthorization;
  readonly storage_options?: readonly WritableStorageOption[];
}

export default function PagePublishForm(props: PagePublishFormProps) {
  const random_name_generator: RandomNameGenerator = useMemo(
    () => new FourWordRandomNameGenerator(),
    [],
  );
  const page_previewer = useMemo(() => new ClientPagePreviewer(), []);
  const [creator_namespaces, set_creator_namespaces] = useState<
    readonly string[]
  >(
    props.authorization.kind === "creator"
      ? props.authorization.owned_namespaces
      : [],
  );
  const initial_primary_namespace = props.authorization.kind === "creator"
    ? (props.authorization.owned_namespaces[0] ?? "")
    : props.initial_namespace;
  const [content_type, set_content_type] = useState<PageContentType>(
    props.initial_content_type ?? "md-page",
  );
  const [primary, set_primary] = useState<PublishReferenceState>({
    id: 0,
    namespace: initial_primary_namespace,
    page_name: "",
    delivery_profile: "inline",
  });
  const [aliases, set_aliases] = useState<readonly PublishReferenceState[]>([]);
  const [markdown, set_markdown] = useState(initial_markdown);
  const [css, set_css] = useState(default_page_style_preset.css);
  const [pdf_file, set_pdf_file] = useState<File | null>(null);
  const [storage_provider_id, set_storage_provider_id] = useState("");
  const [state, set_state] = useState<PublishState>({ status: "idle" });
  const next_alias_id = useRef(1);
  const generated_names = useRef(new Set([initial_primary_namespace]));
  const pdf_file_view = useMemo(
    () =>
      pdf_file === null
        ? pdf_file_selection_presenter.present(null)
        : pdf_file_selection_presenter.present(describe_pdf_file(pdf_file)),
    [pdf_file],
  );

  useEffect(() => {
    if (props.authorization.kind !== "creator") return;

    function add_reserved_namespace(event: Event) {
      const detail = (event as CustomEvent<NamespaceReservedEventDetail>)
        .detail;
      if (typeof detail?.namespace !== "string" || detail.namespace === "") {
        return;
      }
      set_creator_namespaces((current) =>
        current.some((namespace) =>
            namespace.toLowerCase() === detail.namespace.toLowerCase()
          )
          ? current
          : [...current, detail.namespace]
      );
      set_primary((current) =>
        current.namespace === ""
          ? { ...current, namespace: detail.namespace }
          : current
      );
    }

    globalThis.addEventListener(
      namespace_reserved_event_type,
      add_reserved_namespace,
    );
    return () =>
      globalThis.removeEventListener(
        namespace_reserved_event_type,
        add_reserved_namespace,
      );
  }, [props.authorization.kind]);

  function update_draft(update: () => void) {
    update();
    if (state.status === "success" || state.status === "error") {
      set_state({ status: "idle" });
    }
  }

  function generated_name(current_value: string): string {
    if (current_value !== "") generated_names.current.add(current_value);
    const generated = random_name_generator.generate(generated_names.current);
    generated_names.current.add(generated);
    return generated;
  }

  function update_primary(patch: Partial<PublishReferenceState>) {
    update_draft(() => set_primary((current) => ({ ...current, ...patch })));
  }

  function update_alias(id: number, patch: Partial<PublishReferenceState>) {
    update_draft(() =>
      set_aliases((current) =>
        current.map((alias) => alias.id === id ? { ...alias, ...patch } : alias)
      )
    );
  }

  function add_alias() {
    const id = next_alias_id.current++;
    update_draft(() =>
      set_aliases((current) => [...current, {
        id,
        namespace: primary.namespace || creator_namespaces[0] || "",
        page_name: "",
        delivery_profile: "inline",
      }])
    );
  }

  function remove_alias(id: number) {
    update_draft(() =>
      set_aliases((current) => current.filter((alias) => alias.id !== id))
    );
  }

  function select_content_type(value: PageContentType) {
    update_draft(() => {
      set_content_type(value);
      if (value !== "pdf") set_pdf_file(null);
    });
  }

  function reference_draft(
    reference: PublishReferenceState,
  ): PagePublishReferenceDraft {
    return {
      namespace: reference.namespace,
      page_name: reference.page_name,
      delivery_profile: content_type === "pdf"
        ? reference.delivery_profile
        : "inline",
    };
  }

  async function publish(event: JSX.TargetedSubmitEvent<HTMLFormElement>) {
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
      const primary_draft = reference_draft(primary);
      const alias_drafts = aliases.map(reference_draft);
      let response: Response;
      if (content_type === "md-page") {
        const request = prepare_page_publish_request(
          {
            primary: primary_draft,
            aliases: alias_drafts,
            markdown,
            css,
            ...(storage_provider_id === "" ? {} : { storage_provider_id }),
          },
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
        const draft = {
          filename: pdf_file.name,
          bytes: new Uint8Array(await pdf_file.arrayBuffer()),
          access: "public" as const,
          canonical: primary_draft,
          alternates: alias_drafts,
          tags: [],
          ...(storage_provider_id === "" ? {} : { storage_provider_id }),
        };
        const violation = pdf_publish_draft_violation(draft);
        if (violation !== null) {
          set_state({
            status: "error",
            failure: { kind: "pdf", code: null, message: violation },
          });
          return;
        }
        const request = prepare_pdf_publish_request(draft, props.authorization);
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
  const supports_downloadable =
    page_content_type_options.find((option) => option.value === content_type)
      ?.supported_delivery_profiles.includes("attachment") ?? false;
  const creator_without_namespace = props.authorization.kind === "creator" &&
    creator_namespaces.length === 0;
  const current_authorization: PagePublishAuthorization =
    props.authorization.kind === "creator"
      ? { ...props.authorization, owned_namespaces: creator_namespaces }
      : props.authorization;
  return (
    <section class="publish-panel" aria-label="Create a page">
      {creator_without_namespace && (
        <p class="error-message" role="status">
          Reserve a namespace before publishing a managed page.
        </p>
      )}

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

        <ReferenceFields
          reference={primary}
          title="Primary path"
          is_pdf={supports_downloadable}
          authorization={current_authorization}
          on_change={update_primary}
          on_random_namespace={() =>
            update_primary({ namespace: generated_name(primary.namespace) })}
          on_random_page_name={() =>
            update_primary({ page_name: generated_name(primary.page_name) })}
        />

        <section
          class="publish-aliases"
          aria-labelledby="publish-aliases-title"
        >
          <div class="section-heading">
            <h3 id="publish-aliases-title">Optional aliases</h3>
            <p>
              Add another URL for the same page. Aliases do not copy content.
            </p>
          </div>
          {aliases.map((alias, index) => (
            <div class="publish-alias" key={alias.id}>
              <ReferenceFields
                reference={alias}
                title={`Alias ${index + 1}`}
                is_pdf={supports_downloadable}
                authorization={current_authorization}
                on_change={(patch) =>
                  update_alias(alias.id, patch)}
                on_random_namespace={() =>
                  update_alias(alias.id, {
                    namespace: generated_name(alias.namespace),
                  })}
                on_random_page_name={() =>
                  update_alias(alias.id, {
                    page_name: generated_name(alias.page_name),
                  })}
              />
              <button
                type="button"
                onClick={() =>
                  remove_alias(alias.id)}
              >
                Remove alias
              </button>
            </div>
          ))}
          <button
            type="button"
            class="context-button"
            disabled={creator_without_namespace}
            onClick={add_alias}
          >
            Add alias
          </button>
        </section>

        {is_pdf
          ? (
            <div class="pdf-publish-fields">
              <PdfFileSelection
                view={pdf_file_view}
                required
                on_select={(file) => update_draft(() => set_pdf_file(file))}
              />
              <p class="field-hint">
                Each PDF path has one delivery mode. Add an alias when the same
                PDF needs both an in-browser and a downloadable URL.
              </p>
            </div>
          )
          : (
            <PageEditor
              markdown={markdown}
              css={css}
              on_markdown_input={(value) =>
                update_draft(() => set_markdown(value))}
              on_css_input={(value) => update_draft(() => set_css(value))}
              previewer={page_previewer}
            />
          )}

        {(props.storage_options?.length ?? 0) > 0 && (
          <fieldset class="storage-target-chooser">
            <legend>Content storage</legend>
            <label>
              <input
                type="radio"
                name="storage_provider_id"
                value=""
                checked={storage_provider_id === ""}
                onChange={() => update_draft(() => set_storage_provider_id(""))}
              />
              Store content in iam-pager
            </label>
            {props.storage_options?.map((option) => (
              <label key={option.provider_id}>
                <input
                  type="radio"
                  name="storage_provider_id"
                  value={option.provider_id}
                  checked={storage_provider_id === option.provider_id}
                  onChange={() =>
                    update_draft(() =>
                      set_storage_provider_id(option.provider_id)
                    )}
                />
                Store content in {option.label}
              </label>
            ))}
          </fieldset>
        )}

        <button
          type="submit"
          disabled={is_publishing || creator_without_namespace}
        >
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

interface ReferenceFieldsProps {
  readonly reference: PublishReferenceState;
  readonly title: string;
  readonly is_pdf: boolean;
  readonly authorization: PagePublishAuthorization;
  readonly on_change: (patch: Partial<PublishReferenceState>) => void;
  readonly on_random_namespace: () => void;
  readonly on_random_page_name: () => void;
}

function ReferenceFields(props: ReferenceFieldsProps) {
  const suffix = props.reference.id === 0
    ? "primary"
    : String(props.reference.id);
  const namespace_id = `namespace-${suffix}`;
  const page_name_id = `page-name-${suffix}`;
  return (
    <fieldset class="publish-endpoint">
      <legend>{props.title}</legend>
      <div class="locator-fields">
        <div class="contextual-input locator-field">
          <div class="contextual-input-heading">
            <label for={namespace_id}>Namespace</label>
            {props.authorization.kind === "guest" && (
              <button
                type="button"
                class="embedded-input-action"
                aria-label={`Use a random namespace for ${props.title}`}
                onClick={props.on_random_namespace}
              >
                Random
              </button>
            )}
          </div>
          {props.authorization.kind === "creator"
            ? (
              <select
                id={namespace_id}
                name={namespace_id}
                required
                value={props.reference.namespace}
                onChange={(event) =>
                  props.on_change({ namespace: event.currentTarget.value })}
              >
                {props.authorization.owned_namespaces.length === 0 && (
                  <option value="">No reserved namespaces</option>
                )}
                {props.authorization.owned_namespaces.map((namespace) => (
                  <option value={namespace} key={namespace}>{namespace}</option>
                ))}
              </select>
            )
            : (
              <input
                id={namespace_id}
                name={namespace_id}
                required
                value={props.reference.namespace}
                onInput={(event) =>
                  props.on_change({ namespace: event.currentTarget.value })}
                placeholder="your-name"
                autocomplete="off"
              />
            )}
        </div>
        <span class="path-separator" aria-hidden="true">/</span>
        <div class="contextual-input locator-field">
          <div class="contextual-input-heading">
            <label for={page_name_id}>
              Page name <small>optional</small>
            </label>
            <button
              type="button"
              class="embedded-input-action"
              aria-label={`Use a random page name for ${props.title}`}
              onClick={props.on_random_page_name}
            >
              Random
            </button>
          </div>
          <input
            id={page_name_id}
            name={page_name_id}
            value={props.reference.page_name}
            onInput={(event) =>
              props.on_change({ page_name: event.currentTarget.value })}
            placeholder="notes/today"
            autocomplete="off"
          />
        </div>
      </div>
      {props.is_pdf && (
        <DeliveryProfileField
          name={`delivery-profile-${suffix}`}
          value={props.reference.delivery_profile}
          on_change={(delivery_profile) =>
            props.on_change({ delivery_profile })}
        />
      )}
    </fieldset>
  );
}

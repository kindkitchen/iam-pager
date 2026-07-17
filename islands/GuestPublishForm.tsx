import type { JSX } from "preact";
import { useMemo, useRef, useState } from "preact/hooks";
import { PageEditor } from "../components/PageEditor.tsx";
import { ClientPagePreviewer } from "../lib/ui/page-preview.ts";
import { default_page_style_preset } from "../lib/ui/page-style-presets.ts";
import {
  FourWordRandomNameGenerator,
  type RandomNameGenerator,
} from "../lib/ui/random-name.ts";

interface PublishSuccess {
  ok: true;
  path: string;
  url: string;
}

interface PublishFailure {
  ok: false;
  error: string;
  detail: string;
}

type PublishState =
  | { status: "idle" }
  | { status: "publishing" }
  | { status: "success"; result: PublishSuccess }
  | { status: "error"; message: string };

const initial_markdown = `# Your page

Write. Style. Preview. Publish.`;

export interface GuestPublishFormProps {
  /** Generated once on the server so hydration keeps the visible suggestion. */
  initial_namespace: string;
}

export default function GuestPublishForm(props: GuestPublishFormProps) {
  const random_name_generator: RandomNameGenerator = useMemo(
    () => new FourWordRandomNameGenerator(),
    [],
  );
  const page_previewer = useMemo(() => new ClientPagePreviewer(), []);
  const [namespace, set_namespace] = useState(props.initial_namespace);
  const [page_name, set_page_name] = useState("");
  const [markdown, set_markdown] = useState(initial_markdown);
  const [css, set_css] = useState(default_page_style_preset.css);
  const [state, set_state] = useState<PublishState>({ status: "idle" });
  const generated_names = useRef(new Set([namespace]));

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

  async function publish(
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const trimmed_namespace = namespace.trim();
    const trimmed_page_name = page_name.trim();
    const body = {
      namespace: trimmed_namespace,
      ...(trimmed_page_name === "" ? {} : { page_name: trimmed_page_name }),
      md: markdown,
      ...(css === "" ? {} : { css }),
    };

    set_state({ status: "publishing" });
    try {
      const response = await fetch("/api/pages", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      });
      const result = await response.json() as PublishSuccess | PublishFailure;
      if (!response.ok || !result.ok) {
        const detail = result.ok
          ? `Publishing failed (${response.status})`
          : result.detail;
        set_state({ status: "error", message: detail });
        return;
      }
      set_state({ status: "success", result });
    } catch (error) {
      set_state({
        status: "error",
        message: error instanceof Error ? error.message : String(error),
      });
    }
  }

  const is_publishing = state.status === "publishing";
  return (
    <section class="publish-panel" aria-labelledby="publish-heading">
      <div class="section-heading">
        <p class="eyebrow">Guest publishing</p>
        <h2 id="publish-heading">Create a page</h2>
        <p>
          Choose its direct path. A page name is optional; omit it to publish
          the namespace's default page.
        </p>
      </div>

      <form class="publish-form" onSubmit={publish}>
        <div class="locator-fields">
          <label>
            <span class="field-heading">
              <span>Namespace</span>
              <button
                type="button"
                class="helper-button"
                onClick={() => randomize(namespace, set_namespace)}
              >
                Random
              </button>
            </span>
            <input
              name="namespace"
              required
              value={namespace}
              onInput={(event) =>
                update_draft(() => set_namespace(event.currentTarget.value))}
              placeholder="your-name"
              autocomplete="off"
            />
          </label>
          <span class="path-separator" aria-hidden="true">/</span>
          <label>
            <span class="field-heading">
              <span>
                Page name <small>optional</small>
              </span>
              <button
                type="button"
                class="helper-button"
                onClick={() => randomize(page_name, set_page_name)}
              >
                Random
              </button>
            </span>
            <input
              name="page_name"
              value={page_name}
              onInput={(event) =>
                update_draft(() => set_page_name(event.currentTarget.value))}
              placeholder="notes/today"
              autocomplete="off"
            />
          </label>
        </div>

        <PageEditor
          markdown={markdown}
          css={css}
          on_markdown_input={(value) => update_draft(() => set_markdown(value))}
          on_css_input={(value) => update_draft(() => set_css(value))}
          previewer={page_previewer}
        />

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
          <p class="error-message">
            <strong>Could not publish.</strong> {state.message}
          </p>
        )}
      </div>
    </section>
  );
}

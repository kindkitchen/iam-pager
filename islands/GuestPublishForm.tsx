import type { JSX } from "preact";
import { useState } from "preact/hooks";

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

export default function GuestPublishForm() {
  const [state, set_state] = useState<PublishState>({ status: "idle" });

  async function publish(
    event: JSX.TargetedSubmitEvent<HTMLFormElement>,
  ) {
    event.preventDefault();
    const form = event.currentTarget;
    const form_data = new FormData(form);
    const page_name = String(form_data.get("page_name") ?? "").trim();
    const css = String(form_data.get("css") ?? "");
    const body = {
      namespace: String(form_data.get("namespace") ?? "").trim(),
      ...(page_name === "" ? {} : { page_name }),
      md: String(form_data.get("md") ?? ""),
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
        <h2 id="publish-heading">Create a Markdown page</h2>
        <p>
          Choose its direct path. A page name is optional; omit it to publish
          the namespace's default page.
        </p>
      </div>

      <form class="publish-form" onSubmit={publish}>
        <div class="locator-fields">
          <label>
            <span>Namespace</span>
            <input
              name="namespace"
              required
              placeholder="your-name"
              autocomplete="off"
            />
          </label>
          <span class="path-separator" aria-hidden="true">/</span>
          <label>
            <span>
              Page name <small>optional</small>
            </span>
            <input
              name="page_name"
              placeholder="notes/today"
              autocomplete="off"
            />
          </label>
        </div>

        <label>
          <span>Markdown</span>
          <textarea
            name="md"
            required
            rows={12}
            maxLength={64 * 1024}
            placeholder="# Hello world"
          />
          <small>Up to 64 KiB. HTML is sanitized before publishing.</small>
        </label>

        <details>
          <summary>Optional CSS</summary>
          <label>
            <span>Stylesheet</span>
            <textarea
              name="css"
              rows={6}
              maxLength={16 * 1024}
              placeholder="body { max-width: 48rem; margin: 3rem auto; }"
            />
            <small>Up to 16 KiB. Applied only to the direct page.</small>
          </label>
        </details>

        <button type="submit" disabled={is_publishing}>
          {is_publishing ? "Publishing…" : "Publish page"}
        </button>
      </form>

      <div class="publish-result" aria-live="polite">
        {state.status === "success" && (
          <>
            <strong>Page published.</strong>
            <a href={state.result.path} target="_blank" rel="noopener">
              Open {state.result.path}
            </a>
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

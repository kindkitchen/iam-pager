import { useEffect, useRef } from "preact/hooks";

interface PrismApi {
  readonly languages: { readonly css?: unknown };
  highlightElement(element: Element): void;
}

interface PrismGlobal {
  readonly Prism?: PrismApi;
}

export interface CssSourceEditorProps {
  value: string;
  max_length: number;
  on_input: (value: string) => void;
}

function highlighted_value(value: string): string {
  return value.endsWith("\n") ? `${value} ` : value;
}

function prism_api(): PrismApi | undefined {
  return (globalThis as typeof globalThis & PrismGlobal).Prism;
}

export function CssSourceEditor(props: CssSourceEditorProps) {
  const pre_ref = useRef<HTMLPreElement>(null);
  const code_ref = useRef<HTMLElement>(null);

  useEffect(() => {
    let attempts = 0;
    let retry: ReturnType<typeof setTimeout> | undefined;

    function highlight() {
      const code = code_ref.current;
      if (!code) return;
      code.textContent = highlighted_value(props.value);

      const prism = prism_api();
      if (prism?.languages.css) {
        prism.highlightElement(code);
      } else if (attempts < 40) {
        attempts += 1;
        retry = globalThis.setTimeout(highlight, 125);
      }
    }

    highlight();
    return () => {
      if (retry !== undefined) globalThis.clearTimeout(retry);
    };
  }, [props.value]);

  return (
    <div class="css-source-editor">
      <pre
        ref={pre_ref}
        class="language-css"
        aria-hidden="true"
      >
        <code ref={code_ref} class="language-css">
          {highlighted_value(props.value)}
        </code>
      </pre>
      <textarea
        class="css-source-input"
        name="css"
        aria-label="CSS"
        rows={15}
        maxLength={props.max_length}
        value={props.value}
        spellcheck={false}
        onInput={(event) => props.on_input(event.currentTarget.value)}
        onScroll={(event) => {
          const pre = pre_ref.current;
          if (!pre) return;
          pre.scrollTop = event.currentTarget.scrollTop;
          pre.scrollLeft = event.currentTarget.scrollLeft;
        }}
        placeholder="body { max-width: 48rem; margin: 3rem auto; }"
      />
    </div>
  );
}

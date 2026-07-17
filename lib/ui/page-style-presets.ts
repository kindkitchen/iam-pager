export interface PageStylePreset {
  id: string;
  label: string;
  description: string;
  css: string;
}

export const page_style_presets: readonly PageStylePreset[] = [
  {
    id: "plain",
    label: "Plain",
    description: "A quiet readable page.",
    css: `body {
  max-width: 44rem;
  margin: 0 auto;
  padding: 1.25rem;
  color: #20251f;
  background: #fffefa;
  font: 1rem/1.65 system-ui, sans-serif;
}

h1, h2, h3 { line-height: 1.2; }
a { color: #17643a; }
img { max-width: 100%; height: auto; }
pre { overflow-x: auto; padding: 1rem; background: #f1f2ed; }
blockquote { margin-left: 0; border-left: 0.25rem solid #9baa9e; padding-left: 1rem; }

@media (min-width: 40rem) {
  body { padding: 3rem 2rem; }
}`,
  },
  {
    id: "paper",
    label: "Paper",
    description: "Warm editorial typography.",
    css: `body {
  max-width: 42rem;
  margin: 0 auto;
  padding: 1.25rem;
  color: #302b24;
  background: #f5eddd;
  font: 1.08rem/1.75 Georgia, serif;
}

h1, h2, h3 { line-height: 1.15; color: #17130f; }
a { color: #8a3c22; }
img { max-width: 100%; height: auto; }
code { font-family: ui-monospace, monospace; }
pre { overflow-x: auto; padding: 1rem; background: #e9ddc8; }
hr { border: 0; border-top: 1px solid #b9aa91; }

@media (min-width: 40rem) {
  body { padding: 4rem 2rem; }
}`,
  },
  {
    id: "night",
    label: "Night",
    description: "Dark, high-contrast reading.",
    css: `body {
  max-width: 48rem;
  margin: 0 auto;
  padding: 1.25rem;
  color: #d9e2dc;
  background: #111713;
  font: 1rem/1.65 system-ui, sans-serif;
}

h1, h2, h3 { line-height: 1.2; color: #ffffff; }
a { color: #79d99d; }
img { max-width: 100%; height: auto; }
code { color: #a8e6bc; }
pre { overflow-x: auto; padding: 1rem; background: #1d2821; }
blockquote { margin-left: 0; border-left: 0.25rem solid #4e9b68; padding-left: 1rem; }

@media (min-width: 40rem) {
  body { padding: 3rem 2rem; }
}`,
  },
];

export const default_page_style_preset = page_style_presets[0];

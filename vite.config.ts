import { defineConfig } from "vite";
import { fresh } from "@fresh/plugin-vite";

const authentication_runtime_ids = new Set([
  "@kindkitchen/gauth",
  "effect",
]);

export default defineConfig({
  plugins: [
    {
      name: "externalize-authentication-runtime",
      apply: "build",
      enforce: "pre",
      resolveId(source, _importer, options) {
        if (options.ssr && authentication_runtime_ids.has(source)) {
          return { id: source, external: true };
        }
      },
    },
    fresh(),
  ],
});

import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
const languageRegistry = /internal[\\/]langdata[\\/]registry\.json$/;
export default defineConfig({
  plugins: [
    {
      name: "locale-names",
      load(id) {
        const suffix = "?locale-name";
        if (!id.endsWith(".json" + suffix)) return;
        const catalog = JSON.parse(
          readFileSync(id.slice(0, -suffix.length), "utf8"),
        );
        return `export const name = ${JSON.stringify(catalog.name)};`;
      },
    },
  ],
  build: {
    rolldownOptions: {
      output: {
        // The full language registry is a dynamic import of its own
        // (languages.ts) and keeps the name language-data. A code-splitting
        // group would also name it, but a group chunk needs a namespace
        // helper that rolldown then moves into an extra startup chunk.
        chunkFileNames: (chunk) =>
          languageRegistry.test(chunk.facadeModuleId ?? "")
            ? "assets/language-data-[hash].js"
            : "assets/[name]-[hash].js",
      },
    },
  },
});

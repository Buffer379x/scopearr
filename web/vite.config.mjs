import { defineConfig } from "vite";
import { readFileSync } from "node:fs";
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
        codeSplitting: {
          groups: [
            {
              name: "language-data",
              test: /internal[\\/]langdata[\\/]registry\.json(?:\?|$)/,
            },
          ],
        },
      },
    },
  },
});

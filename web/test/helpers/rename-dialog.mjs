import { loadSource, PRESENTATION_MODULES } from "./component-harness.mjs";
import { createHookRuntime } from "./hook-runtime.mjs";

// RenameCompanionsDialog for release-160-rename (Phase 5d: the v2 modal,
// its checkbox and ToolDiskTag). The real TSX component runs with a hook
// runtime; Modal and ModalFoot are named stubs, ToolDiskTag is the real
// one, so a test can render a tag it finds.
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, useI18n: () => ({ locale: "en" }) };
export const rename = loadSource("file-rename.ts", {
  modules: {
    "./mux-spec.ts": loadSource("mux-spec.ts", {
      modules: { "./languages.ts": {} },
    }),
  },
});
const tagRuntime = createHookRuntime();
const { ToolDiskTag } = loadSource("components/tools/ToolDiskTag.tsx", {
  modules: {
    "preact/hooks": tagRuntime.hooks,
    "../../i18n": i18n,
    "../../placement": loadSource("placement.ts"),
    "../../ui": { compactBytes: String },
  },
});

export function nodes(value) {
  if (Array.isArray(value)) return value.flatMap(nodes);
  if (!value || typeof value !== "object") return [];
  return [value, ...nodes(value.props?.children)];
}
export function text(value) {
  if (Array.isArray(value)) return value.map(text).join("");
  if (value && typeof value === "object") return text(value.props?.children);
  return typeof value === "string" ? value : "";
}
export function preview(override = {}) {
  return {
    filename: "New.mkv",
    device: "disk1",
    userShare: false,
    companions: [
      {
        from: "Old.de.srt",
        to: "New.de.srt",
        conflict: false,
        device: "cache",
      },
    ],
    ...override,
  };
}
// The dialog's tree for a preview, rendered once with fresh state.
export function dialog(p, save = () => {}) {
  const runtime = createHookRuntime();
  const { RenameCompanionsDialog } = loadSource(
    "components/RenameCompanionsDialog.tsx",
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../i18n": i18n,
        "../ui": { ICON: { label: 15, button: 16 } },
        "../file-rename": rename,
        "./settings/Check": loadSource("components/settings/Check.tsx"),
        "./tools/ToolDiskTag": { ToolDiskTag },
      },
      stubs: PRESENTATION_MODULES.filter(
        (path) => path !== "components/tools/ToolDiskTag",
      ),
    },
  );
  return runtime.settle(() =>
    RenameCompanionsDialog({ preview: p, close() {}, save }),
  );
}

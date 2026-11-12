import type { MuxToolStatus } from "./types";
// The package actions in three fixed places (ruling P4): Download or Update,
// Check for updates, Remove. Remove is locked before the answer and while
// the tool is not installed, so the row never gains or loses a button.
export function toolPackageActions(
  status: Pick<MuxToolStatus, "installed" | "busy"> | undefined,
  enabled: boolean,
  demo: boolean,
) {
  const installed = !!status?.installed;
  return [installed ? "update" : "install", "check", "remove"].map(
    (action) => ({
      action,
      disabled:
        demo || !!status?.busy || (action === "remove" ? !installed : !enabled),
    }),
  );
}

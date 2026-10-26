import type { MuxToolStatus } from "./types";
export function toolPackageActions(
  status: Pick<MuxToolStatus, "installed" | "busy"> | undefined,
  enabled: boolean,
  demo: boolean,
) {
  const actions = [
    status?.installed ? "update" : "install",
    "check",
    ...(status?.installed ? ["remove"] : []),
  ];
  return actions.map((action) => ({
    action,
    disabled: demo || !!status?.busy || (!enabled && action !== "remove"),
  }));
}

import { audioLanguage, isUnknownAudioLanguage } from "./languages.ts";
const fields = [
  "resolution",
  "codec",
  "family",
  "source",
  "processing",
  "hdr",
  "bitDepth",
  "audio",
  "channels",
  "language",
  "custom",
  "track",
];
const language = (v: string) =>
  isUnknownAudioLanguage(v)
    ? "__unknown__"
    : audioLanguage(v)?.aliases[0] || v.trim();
// An audio track combination as presets.go keeps it: three trimmed parts,
// the language normalized, any ("") apart from __unknown__; a value the API
// rejects (not three parts, none set, a part over 80) carries no identity.
const track = (v: string) => {
  const parts = v.split("|").map((part) => part.trim());
  if (
    parts.length !== 3 ||
    !parts.some(Boolean) ||
    parts.some((part) => [...part].length > 80)
  )
    return "";
  if (parts[0]) parts[0] = language(parts[0]);
  return parts.join("|");
};
export function canonicalPresetQuery(query: string): string {
  const input = new URLSearchParams(query),
    output = new URLSearchParams();
  for (const field of fields) {
    const values = [
      ...new Set(
        input
          .getAll(field)
          .map((v) =>
            field === "track"
              ? track(v)
              : !v || v === "__unknown__"
                ? "__unknown__"
                : field === "language"
                  ? language(v)
                  : v,
          )
          .filter(Boolean),
      ),
    ].sort();
    values.forEach((v) => output.append(field, v));
    let op = input.get(field + "Op") || "eq";
    if (values.length === 1)
      op = op === "all" ? "eq" : op === "notAll" ? "not" : op;
    if (values.length && op !== "eq") output.set(field + "Op", op);
  }
  const terms = [
    ...new Set(
      (input.get("q") || "").trim().toLowerCase().split(/\s+/).filter(Boolean),
    ),
  ].sort();
  if (terms.length) output.set("q", terms.join(" "));
  for (const key of ["yearMin", "yearMax", "sizeMin", "sizeMax"]) {
    const v = input.get(key);
    if (v) {
      try {
        output.set(key, BigInt(v).toString());
      } catch {
        output.set(key, v);
      }
    }
  }
  for (const key of [
    "instance",
    "conflict",
    "confirmed",
    "mediaInfo",
    "ruleConflict",
    "metadata",
    "embyMatch",
    "seasonOutlier",
    "languageOutlier",
    "mediaMatched",
    "mediaMissing",
    "mediaAmbiguous",
    "mediaConflicting",
    "mediaNoTracks",
    "mediaPending",
    "mediaUnconfigured",
  ]) {
    const v = input.get(key);
    if (v) output.set(key, v);
  }
  for (const key of ["unknownYear", "unknownSize"])
    if (input.get(key) === "true") output.set(key, "true");
  output.sort();
  return output.toString();
}

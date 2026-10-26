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
];
export function canonicalPresetQuery(query: string): string {
  const input = new URLSearchParams(query),
    output = new URLSearchParams();
  for (const field of fields) {
    const values = [
      ...new Set(
        input
          .getAll(field)
          .map((v) =>
            !v || v === "__unknown__"
              ? "__unknown__"
              : field === "language"
                ? isUnknownAudioLanguage(v)
                  ? "__unknown__"
                  : audioLanguage(v)?.aliases[0] || v.trim()
                : v,
          ),
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

import {
  SortableHeader,
  nextTableSort,
  type TableSort,
} from "./SortableHeader";
import { ICON, Tooltip } from "../ui";
import { RuleEditor } from "./RuleEditor";
import {
  recognitionFields as fields,
  recognitionModes as modes,
} from "../recognition-options";
import { confirmDeletion } from "../confirmation";
import { mergeRuleDraft, sameRuleDraft } from "../rule-draft";
import { matchesRuleSearch } from "../rule-search";
import { newRuleID } from "../rule-id";
import { notify } from "../notifications";
import {
  Check,
  LoaderCircle,
  Pencil,
  Plus,
  Search,
  Trash2,
  OctagonAlert,
} from "lucide-preact";
import { useEffect, useState, useContext } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type {
  RecognitionConfig,
  RecognitionRule,
  RecognitionResult,
} from "../types";
import { labels, CustomTagNames } from "../ui";
const columns: [keyof RecognitionRule, string][] = [
  ["priority", "Priority"],
  ["enabled", "Enabled"],
  ["tag", "Tag color"],
  ["name", "Name"],
  ["field", "Attribute"],
  ["match", "Match type"],
  ["pattern", "Pattern"],
  ["value", "Result"],
  ["mode", "Mode"],
];
export function RecognitionPage({
  saved,
  onDirty,
}: {
  saved: () => Promise<void>;
  onDirty: (dirty: boolean) => void;
}) {
  useI18n();
  const customNames = useContext(CustomTagNames);
  const [config, setConfig] = useState<RecognitionConfig | null>(null),
    [rules, setRules] = useState<RecognitionRule[]>([]),
    [sort, setSort] = useState<TableSort>(null),
    [editing, setEditing] = useState<RecognitionRule | null>(null),
    [ruleSearch, setRuleSearch] = useState(""),
    [filename, setFilename] = useState(""),
    [preview, setPreview] = useState<RecognitionResult | null>(null),
    [error, setError] = useState(""),
    [notice, setNotice] = useState(""),
    [busy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false);
  useEffect(() => {
    if (notice) {
      notify(notice);
      setNotice("");
    }
  }, [notice]);
  const dirty = !!config && !sameRuleDraft(rules, config.rules);
  useEffect(() => {
    onDirty(dirty || busy);
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || busy) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, busy]);
  useEffect(() => () => onDirty(false), []);
  const load = async () => {
    try {
      const current = await api<RecognitionConfig>("recognition");
      setConfig(current);
      setRules(current.rules);
      setError("");
      setPreview(null);
    } catch (e) {
      setError((e as Error).message);
    }
  };
  useEffect(() => {
    void load();
  }, []);
  const change = async (next: RecognitionRule[], draft = next) => {
    if (!config || busy) return false;
    const previous = rules;
    setBusy(true);
    setRules(draft);
    setPreview(null);
    try {
      const current = await api<RecognitionConfig>("recognition", "PUT", {
        rules: next,
        revision: config.revision,
      });
      setConfig(current);
      setRules(mergeRuleDraft(next, draft, current.rules));
      notify(t("Rules saved. Cached filenames have been reprocessed."));
      try {
        await saved();
      } catch (e) {
        setError((e as Error).message);
      }
      return true;
    } catch (e) {
      setRules(previous);
      setError((e as Error).message);
      return false;
    } finally {
      setBusy(false);
    }
  };
  const filtered = rules.filter((rule) =>
    matchesRuleSearch(ruleSearch, [
      String(rule.priority),
      t(rule.enabled ? "Enabled" : "Disabled"),
      t(rule.tag !== false ? "Tag color" : "Default presentation"),
      rule.name,
      labels[rule.field],
      t(rule.match === "token" ? "Token" : "Regular expression"),
      rule.pattern,
      rule.field === "custom"
        ? customNames[rule.value] || rule.value
        : rule.value,
      t(modes[rule.mode as keyof typeof modes]),
      rule.unless || "",
      rule.comparisonPattern || "",
    ]),
  );
  const sortField = (sort?.field || "priority") as keyof RecognitionRule;
  const sorted = [...filtered].sort((a, b) => {
    const x =
        sortField === "tag"
          ? a.tag !== false
          : sortField === "value" && a.field === "custom"
            ? customNames[a.value] || a.value
            : a[sortField],
      y =
        sortField === "tag"
          ? b.tag !== false
          : sortField === "value" && b.field === "custom"
            ? customNames[b.value] || b.value
            : b[sortField];
    const cmp =
      typeof x === "number" && typeof y === "number"
        ? x - y
        : String(x).localeCompare(String(y));
    return (
      (sort?.direction === "desc" ? -cmp : cmp) || a.id.localeCompare(b.id)
    );
  });
  return (
    <section class="recognition-page">
      <header class="settings-section-heading">
        <h2>{t("Tag rules")}</h2>
        <button
          type="button"
          class="primary"
          disabled={!config || busy || !dirty}
          onClick={() => void change(rules)}
        >
          {busy ? (
            <LoaderCircle class="spin" size={ICON.label} />
          ) : (
            <Check size={ICON.label} />
          )}{" "}
          {t("Save settings")}
        </button>
        <p class="quiet">
          {t(
            "Rules only read filenames. API metadata fills remaining gaps; Media server audio tracks stay separate. No media scans are triggered.",
          )}
        </p>
      </header>
      <div class="recognition-guide">
        {Object.entries(modes).map(([mode, label]) => (
          <div>
            <b>{t(label)}</b>
            <p>
              {t(
                mode === "direct"
                  ? "Recognizes explicit filename values."
                  : mode === "fallback"
                    ? "Fills a field only when direct recognition found no value."
                    : "Intentionally replaces direct and fallback values.",
              )}
            </p>
          </div>
        ))}
      </div>
      <div class="notice recognition-notice">
        <ul>
          <li>
            {t(
              "Lower priority numbers run first; ties use the rule ID. Table sorting does not change priority. Different scalar values create a warning; HDR, audio codecs and languages are additive.",
            )}
          </li>
          <li>
            {t(
              "Custom rules add all matching tags; different tags are not conflicts.",
            )}
          </li>
          <li>
            {t(
              "Tag color controls colored presentation only. All recognized values remain tags for filters and synchronization. Checkbox changes apply together with Save settings; adding and deleting save immediately.",
            )}
          </li>
        </ul>
      </div>{" "}
      {error && !config && (
        <button class="button" onClick={() => void load()}>
          {t("Reload rules")}
        </button>
      )}
      {!config && !error && (
        <p class="quiet">
          <LoaderCircle class="spin" size={ICON.button} />
          {t("Loading rules …")}
        </p>
      )}
      {config && (
        <>
          <section class="settings-card recognition-rules">
            <div class="card-heading">
              <h3 class="card-title">
                {t("Rules")}{" "}
                <span class="filter-count" title={t("Rules in the list")}>
                  {filtered.length}
                </span>
              </h3>
              <div class="results-tools card-actions">
                <button
                  class="button"
                  disabled={busy || rules.length >= 256}
                  onClick={() =>
                    setEditing({
                      id: newRuleID(),
                      name: "",
                      field: "resolution",
                      match: "token",
                      pattern: "",
                      value: "",
                      mode: "fallback",
                      priority: 100,
                      enabled: true,
                      consume: false,
                    })
                  }
                >
                  <Plus size={ICON.label} />
                  {t("Add rule")}
                </button>
              </div>
            </div>
            <label class="search-field recognition-rule-search">
              <span>{t("Search recognition rules")}</span>
              <div class="input-wrap">
                <Search size={ICON.button} />
                <input
                  type="search"
                  aria-label={t("Search recognition rules")}
                  placeholder={t("Search all rule columns …")}
                  value={ruleSearch}
                  onInput={(e) => setRuleSearch(e.currentTarget.value)}
                />
              </div>
            </label>
            <div class="table-wrap">
              <table class="data-table recognition-table">
                <thead>
                  <tr>
                    {columns.map(([field, label]) => (
                      <SortableHeader
                        label={t(label)}
                        className={
                          field === "priority"
                            ? "number"
                            : ["enabled", "tag"].includes(field)
                              ? "col-control"
                              : undefined
                        }
                        active={sortField === field}
                        direction={sort?.direction || "asc"}
                        onSort={() => setSort(nextTableSort(sort, field))}
                      />
                    ))}
                    <th scope="col" class="col-control">
                      <span class="sr-only">{t("Actions")}</span>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((rule) => (
                    <tr
                      key={rule.id}
                      class={!rule.enabled ? "rule-disabled" : ""}
                    >
                      <td class="number">{rule.priority}</td>
                      <td class="col-control">
                        <input
                          type="checkbox"
                          aria-label={t("Enable rule: {name}", {
                            name: rule.name,
                          })}
                          checked={rule.enabled}
                          disabled={busy}
                          onChange={(e) =>
                            setRules(
                              rules.map((r) =>
                                r.id === rule.id
                                  ? { ...r, enabled: e.currentTarget.checked }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td class="col-control">
                        <input
                          type="checkbox"
                          checked={rule.tag !== false}
                          disabled={busy}
                          aria-label={t("Use tag color: {name}", {
                            name: rule.name,
                          })}
                          onChange={(e) =>
                            void setRules(
                              rules.map((r) =>
                                r.id === rule.id
                                  ? { ...r, tag: e.currentTarget.checked }
                                  : r,
                              ),
                            )
                          }
                        />
                      </td>
                      <td>
                        <b class="cell-title">{rule.name}</b>
                        {rule.id.startsWith("default-") && (
                          <small class="quiet">{t("Default rule")}</small>
                        )}
                      </td>
                      <td>{labels[rule.field]}</td>
                      <td>
                        {t(
                          rule.match === "token"
                            ? "Token"
                            : "Regular expression",
                        )}
                      </td>
                      <td class="rule-pattern">
                        <Tooltip content={rule.pattern}>
                          <code tabIndex={0} title={rule.pattern}>
                            {rule.pattern}
                          </code>
                        </Tooltip>
                      </td>
                      <td>
                        {rule.field === "custom"
                          ? customNames[rule.value] || rule.value
                          : rule.value}
                      </td>
                      <td>{t(modes[rule.mode])}</td>
                      <td class="rule-actions col-control">
                        <div class="info-actions">
                          <button
                            class="icon-button"
                            disabled={busy}
                            aria-label={t("Edit rule: {name}", {
                              name: rule.name,
                            })}
                            onClick={() => setEditing({ ...rule })}
                            title={t("Edit rule: {name}", {
                              name: rule.name,
                            })}
                          >
                            <Pencil size={ICON.button} />
                          </button>
                          <button
                            class="icon-button danger-button"
                            disabled={busy}
                            aria-label={t("Delete rule: {name}", {
                              name: rule.name,
                            })}
                            onClick={async () => {
                              if (
                                await confirmDeletion(
                                  t("Delete rule {name}?", { name: rule.name }),
                                )
                              )
                                change(
                                  config!.rules.filter((r) => r.id !== rule.id),
                                  rules.filter((r) => r.id !== rule.id),
                                );
                            }}
                            title={t("Delete rule: {name}", {
                              name: rule.name,
                            })}
                          >
                            <Trash2 size={ICON.button} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!!rules.length && !filtered.length && (
                <p class="quiet empty-rules">{t("No matching rules.")}</p>
              )}
              {!rules.length && (
                <p class="quiet empty-rules">
                  {t(
                    "No filename rules. Only API and media server metadata will be used.",
                  )}
                </p>
              )}
            </div>
          </section>
          <section class="recognition-preview">
            <h2>{t("Preview filename")}</h2>
            <p class="quiet">
              {t(
                "Preview uses the current rule draft and the filename only. API and media server enrichment is not included.",
              )}
            </p>
            <form
              onSubmit={async (e) => {
                e.preventDefault();
                setPreviewBusy(true);
                setError("");
                try {
                  setPreview(
                    await api<RecognitionResult>(
                      "recognition/preview",
                      "POST",
                      { rules, filename },
                    ),
                  );
                } catch (e) {
                  setError((e as Error).message);
                } finally {
                  setPreviewBusy(false);
                }
              }}
            >
              <label>
                {t("Filename")}
                <input
                  required
                  maxLength={2048}
                  value={filename}
                  placeholder="Movie.UHDBD.x265.mkv"
                  onInput={(e) => {
                    setFilename(e.currentTarget.value);
                    setPreview(null);
                  }}
                />
              </label>
              <button
                type="submit"
                class="button"
                disabled={busy || previewBusy}
              >
                {previewBusy ? (
                  <LoaderCircle class="spin" size={ICON.label} />
                ) : (
                  <Search size={ICON.label} />
                )}{" "}
                {t("Preview")}
              </button>
            </form>
            <>
              <div class="table-wrap">
                <table class="detail-table">
                  <thead>
                    <tr>
                      <th scope="col">{t("Attribute")}</th>
                      <th scope="col">{t("Result")}</th>
                      <th scope="col">{t("Matching rules")}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {fields.map((field) => (
                      <tr>
                        <td>{labels[field]}</td>
                        <td>
                          {preview
                            ? (field === "custom"
                                ? (preview.values[field] || "")
                                    .split(" + ")
                                    .map((id) => customNames[id] || id)
                                    .filter(Boolean)
                                    .join(" · ")
                                : preview.values[field]) || t("Unknown")
                            : "—"}
                        </td>
                        <td>
                          {(preview?.matches[field] || [])
                            .map(
                              (id) =>
                                rules.find((r) => r.id === id)?.name || id,
                            )
                            .join(" · ") || "—"}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {!!preview?.conflicts.length && (
                <div class="notice recognition-conflict-details">
                  <OctagonAlert size={ICON.button} />
                  <div>
                    <b>{t("Conflicting recognition rules")}</b>
                    {preview.conflicts.map((c) => (
                      <p>
                        {labels[c.field]}: {c.values.join(" / ")} ·{" "}
                        {c.ruleNames.join(" · ")}
                      </p>
                    ))}
                  </div>
                </div>
              )}
            </>
          </section>
        </>
      )}
      {editing && (
        <RuleEditor
          rule={editing}
          busy={busy}
          close={() => {
            if (!busy) setEditing(null);
          }}
          save={async (rule) => {
            const ok = await change(
              config!.rules.some((r) => r.id === rule.id)
                ? config!.rules.map((r) => (r.id === rule.id ? rule : r))
                : [...config!.rules, rule],
              rules.some((r) => r.id === rule.id)
                ? rules.map((r) => (r.id === rule.id ? rule : r))
                : [...rules, rule],
            );
            if (ok) setEditing(null);
          }}
        />
      )}
    </section>
  );
}

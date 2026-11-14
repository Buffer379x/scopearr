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
  LoaderCircle,
  OctagonAlert,
  Pencil,
  Plus,
  Search,
  Trash2,
} from "lucide-preact";
import type { ComponentChildren } from "preact";
import { useEffect, useState, useContext } from "preact/hooks";
import { api } from "../api";
import { t, useI18n } from "../i18n";
import type {
  RecognitionConfig,
  RecognitionRule,
  RecognitionResult,
} from "../types";
import { ICON, labels, CustomTagNames } from "../ui";
import { sortRules } from "../settings-model";
import { HelpTip } from "./list/HelpTip";
import { ListEmpty } from "./list/ListEmpty";
import { RowButton } from "./list/RowButton";
import { asFilmSort, SortHeader } from "./list/SortHeader";
import { TableCard } from "./list/TableCard";
import { nextTableSort, type TableSort } from "./SortableHeader";
import { card, colorTable, table } from "./settings/Card";
import { field } from "./settings/Field";
import { SettingsHeader } from "./settings/SettingsHeader";

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
// The rows that hold the table until the rules arrive: the rule count of
// the last read or save in this session, before the first one the shipped
// default rules (DefaultRecognitionRules, 64). So neither the Preview card
// below the table nor the count moves when the rules arrive (D22); the
// card starts below the fold.
const SHIPPED_RULES = 64;
let reserved = SHIPPED_RULES;
// A text of a fixed-width column: cut with an ellipsis, whole in its title.
const cut = (text: string) => <span title={text}>{text}</span>;
const NBSP = " ";

// Settings → Tag rules (docs/STYLEGUIDE.md, Part 1, 11.4): its own band
// (the SettingsHeader; Save settings saves the rule draft, as in 1.7.0)
// and a v2-set of the card "Rules", a TableCard without chips and footer
// (its count, in its head the search, Add rule and the help, ruling R-P),
// and the card "Preview filename". The table is flat and sortable by each
// of the nine 1.7.0 fields (ruling R-F); ties list by name in natural order
// (sortRules, D19). Placeholder rows hold it until the rules arrive; the
// preview has a fixed row per field. Checkbox changes are a draft until
// Save settings; adding, editing and deleting save at once. The area's own
// guard (onDirty) and beforeunload are those of 1.7.0.
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
    [busy, setBusy] = useState(false),
    [previewBusy, setPreviewBusy] = useState(false);
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
      reserved = current.rules.length;
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
      reserved = current.rules.length;
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
  const result = (rule: RecognitionRule) =>
    rule.field === "custom"
      ? customNames[rule.value] || rule.value
      : rule.value;
  const filtered = rules.filter((rule) =>
    matchesRuleSearch(ruleSearch, [
      String(rule.priority),
      t(rule.enabled ? "Enabled" : "Disabled"),
      t(rule.tag !== false ? "Tag color" : "Default presentation"),
      rule.name,
      labels[rule.field],
      t(rule.match === "token" ? "Token" : "Regular expression"),
      rule.pattern,
      result(rule),
      t(modes[rule.mode as keyof typeof modes]),
      rule.unless || "",
      rule.comparisonPattern || "",
    ]),
  );
  const sorted = sortRules(filtered, sort, customNames);
  const toggle = (rule: RecognitionRule, key: "enabled" | "tag") => (
    <input
      type="checkbox"
      class="v2-check"
      aria-label={t(
        key === "enabled" ? "Enable rule: {name}" : "Use tag color: {name}",
        { name: rule.name },
      )}
      checked={key === "enabled" ? rule.enabled : rule.tag !== false}
      disabled={busy}
      onChange={(e) => {
        const checked = e.currentTarget.checked;
        setRules(
          rules.map((r) => (r.id === rule.id ? { ...r, [key]: checked } : r)),
        );
      }}
    />
  );
  const heads = [...columns.map(([, label]) => t(label)), t("Actions")];
  // The sort heads of the nine fields (asc, desc, then the default:
  // priority ascending, nextTableSort); Actions is a plain head.
  const sortHead = (at: number) => {
    const key = columns[at]?.[0];
    if (!key) return undefined;
    return (
      <SortHeader
        key={key}
        label={heads[at]}
        field={key}
        sort={asFilmSort(sort, "priority")}
        onSort={(next) => setSort(nextTableSort(sort, next))}
        numeric={key === "priority"}
        grow={key === "name"}
      />
    );
  };
  const rows = sorted.map((rule): [string, ComponentChildren[], string?] => [
    rule.id,
    [
      rule.priority,
      toggle(rule, "enabled"),
      toggle(rule, "tag"),
      <div class="v2-set-rule">
        <div class="v2-table-name" title={rule.name}>
          {rule.name}
        </div>
        {rule.id.startsWith("default-") && (
          <div class="v2-table-sub">{t("Default rule")}</div>
        )}
      </div>,
      cut(labels[rule.field]),
      cut(t(rule.match === "token" ? "Token" : "Regular expression")),
      <code class="v2-table-mono v2-set-pattern" title={rule.pattern}>
        {rule.pattern}
      </code>,
      cut(result(rule)),
      cut(t(modes[rule.mode])),
      <span class="v2-table-items">
        <RowButton
          label={t("Edit rule: {name}", { name: rule.name })}
          icon={<Pencil size={ICON.button} />}
          disabled={busy}
          onClick={() => setEditing({ ...rule })}
        />
        <RowButton
          label={t("Delete rule: {name}", { name: rule.name })}
          icon={<Trash2 size={ICON.button} />}
          tone="danger"
          disabled={busy}
          onClick={async () => {
            if (
              await confirmDeletion(
                t("Delete rule {name}?", { name: rule.name }),
              )
            )
              await change(
                config!.rules.filter((r) => r.id !== rule.id),
                rules.filter((r) => r.id !== rule.id),
              );
          }}
        />
      </span>,
    ],
    rule.enabled ? undefined : "v2-row--off",
  ]);
  // Until the rules arrive: rows of the same cells, the name with its
  // second line, so a placeholder is as high as a default rule's row.
  const placeholders = Array.from(
    { length: reserved },
    (_, i): [string, ComponentChildren[], string] => [
      "placeholder" + i,
      heads.map((_, at) =>
        at === 3 ? (
          <div class="v2-set-rule">
            <div class="v2-table-name">{NBSP}</div>
            <div class="v2-table-sub">{NBSP}</div>
          </div>
        ) : (
          NBSP
        ),
      ),
      "v2-row--placeholder",
    ],
  );
  const help = [
    {
      heading: "Modes",
      raw: true,
      text: Object.entries(modes)
        .map(
          ([mode, label]) =>
            t(label) +
            " · " +
            t(
              mode === "direct"
                ? "Recognizes explicit filename values."
                : mode === "fallback"
                  ? "Fills a field only when direct recognition found no value."
                  : "Intentionally replaces direct and fallback values.",
            ),
        )
        .join("\n\n"),
    },
    {
      heading: "Priority and conflicts",
      raw: true,
      text: [
        "Lower priority numbers run first; ties run in rule ID order. The table lists ties by name; sorting it does not change priority. Different scalar values create a warning; HDR, audio codecs and languages are additive.",
        "Custom rules add all matching tags; different tags are not conflicts.",
        "Tag color controls colored presentation only. All recognized values remain tags for filters and synchronization. Checkbox changes apply together with Save settings; adding and deleting save immediately.",
      ]
        .map((value) => t(value))
        .join("\n\n"),
    },
  ];
  let body: ComponentChildren;
  if (!config && error)
    body = (
      <ListEmpty icon={<OctagonAlert size={ICON.empty} />} title={error}>
        <button type="button" class="v2-btn" onClick={() => void load()}>
          {t("Reload rules")}
        </button>
      </ListEmpty>
    );
  else if (!config)
    body = (
      <>
        <span class="v2-sr-only" role="status">
          {t("Loading rules …")}
        </span>
        {table(heads, placeholders, 0, sortHead, 3, "v2-set-rules")}
      </>
    );
  else if (!sorted.length)
    body = (
      <ListEmpty
        icon={<Search size={ICON.empty} />}
        title={t(
          rules.length
            ? "No matching rules."
            : "No filename rules. Only API and media server metadata will be used.",
        )}
      />
    );
  else body = table(heads, rows, 0, sortHead, 3, "v2-set-rules");
  return (
    <>
      <SettingsHeader
        section="recognition"
        save={{
          action: () => void change(rules),
          busy,
          disabled: !config || !dirty,
          dirty,
        }}
      />
      <div class="v2-set">
        <TableCard
          id="recognition-rules"
          title={t("Rules")}
          count={config ? filtered.length : error ? 0 : reserved}
          countTitle={t("Rules in the list")}
          busy={busy || (!config && !error)}
          density="comfortable"
          regionLabel={t("Tag rules")}
          bar={
            <div class="v2-filter-bar">
              <div class="v2-input-group">
                <Search class="v2-input-icon" size={ICON.button} />
                <input
                  type="search"
                  class="v2-input"
                  aria-label={t("Search recognition rules")}
                  placeholder={t("Search all rule columns …")}
                  value={ruleSearch}
                  onInput={(e) => setRuleSearch(e.currentTarget.value)}
                />
              </div>
              <button
                type="button"
                class="v2-btn"
                disabled={!config || busy || rules.length >= 256}
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
                <span class="v2-btn-icon" aria-hidden="true">
                  <Plus size={ICON.button} />
                </span>
                {t("Add rule")}
              </button>
              <HelpTip label="Tag rules help" sections={help} />
            </div>
          }
        >
          {body}
        </TableCard>
        {card(
          "recognition-preview",
          t("Preview filename"),
          <>
            <p>
              {t(
                "Preview uses the current rule draft and the filename only. API and media server enrichment is not included.",
              )}
            </p>
            <form
              class="v2-set-preview"
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
              {field("recognition-preview-file", t("Filename"), (a) => (
                <input
                  {...a}
                  class="v2-input"
                  required
                  maxLength={2048}
                  value={filename}
                  placeholder="Movie.UHDBD.x265.mkv"
                  onInput={(e) => {
                    setFilename(e.currentTarget.value);
                    setPreview(null);
                  }}
                />
              ))}
              <button
                type="submit"
                class="v2-btn"
                disabled={!config || busy || previewBusy}
              >
                <span class="v2-btn-icon" aria-hidden="true">
                  {previewBusy ? (
                    <LoaderCircle class="v2-spin" size={ICON.button} />
                  ) : (
                    <Search size={ICON.button} />
                  )}
                </span>
                {t("Preview")}
              </button>
            </form>
            {colorTable(
              [t("Attribute"), t("Result"), t("Matching rules")],
              fields.map((key) => [
                key,
                [
                  labels[key],
                  preview
                    ? (key === "custom"
                        ? (preview.values[key] || "")
                            .split(" + ")
                            .map((id) => customNames[id] || id)
                            .filter(Boolean)
                            .join(" · ")
                        : preview.values[key]) || t("Unknown")
                    : "—",
                  (preview?.matches[key] || [])
                    .map((id) => rules.find((r) => r.id === id)?.name || id)
                    .join(" · ") || "—",
                ],
              ]),
            )}
            {!!preview?.conflicts.length && (
              <div class="v2-notice v2-notice--warn v2-notice--setup">
                <OctagonAlert size={ICON.button} />
                <div class="v2-notice-body">
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
          </>,
        )}
      </div>
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
    </>
  );
}

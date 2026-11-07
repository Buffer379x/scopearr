import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { confirmDiscard } from "../confirmation";
import { t, useI18n } from "../i18n";
import { instancesOf, instanceByID, updateInstance } from "../instances";
import { notify } from "../notifications";
import { settingsPayload } from "../settings-payload";
import {
  tagTransition,
  type TagDecision,
  type TagTransition,
} from "../tag-policy";
import type { TagPreview, TagReviewRequest } from "../components/TagReview";
import type { Settings } from "../types";

// The settings draft: unsaved changes, the leave guards (section change,
// beforeunload, onDirty for the app navigation) and saving with tag review.
// The navigation owns the section: the frame's section links ask the guard
// below (confirmSectionChange) through openLink, then open the section.
export function useSettingsDraft({
  settings,
  section,
  onDirty,
  saved,
}: {
  settings: Settings;
  section: string;
  onDirty: (dirty: boolean) => void;
  saved: (settings: Settings) => Promise<void>;
}) {
  const { locale, setLocale } = useI18n();
  const [draftLocale, setDraftLocale] = useState(locale);
  const [tagChanges, setTagChanges] = useState<TagTransition[] | null>(null);
  const [customDirty, setCustomDirty] = useState(false);
  const [rulesDirty, setRulesDirty] = useState(false);
  const [tagSaveReview, setTagSaveReview] = useState<{
    next: Settings;
    requests: TagReviewRequest[];
    previews: TagPreview[];
  } | null>(null);
  const [cfg, setCfg] = useState<Settings>(structuredClone(settings)),
    [busy, setBusy] = useState(false);

  const dirty =
    JSON.stringify(cfg) !== JSON.stringify(settings) || draftLocale !== locale;
  useEffect(() => {
    onDirty(dirty || rulesDirty || customDirty);
  }, [dirty, rulesDirty, customDirty]);
  useEffect(() => () => onDirty(false), []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (dirty || rulesDirty || customDirty) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [dirty, rulesDirty, customDirty]);
  // Asks before unsaved changes of the open section are lost and discards
  // the draft only when allowed. It opens nothing, so back/forward and links
  // can ask before they apply a route; the open section never asks.
  const confirmSectionChange = async (next: string) => {
    if (next === section) return true;
    if (
      section === "custom" &&
      customDirty &&
      !(await confirmDiscard(t("Discard unsaved settings changes?")))
    )
      return false;
    if (
      section === "recognition" &&
      rulesDirty &&
      !(await confirmDiscard(t("Discard unsaved rule changes?")))
    )
      return false;
    if (
      dirty &&
      !(await confirmDiscard(t("Discard unsaved settings changes?")))
    )
      return false;
    if (dirty) {
      setCfg(structuredClone(settings));
      setDraftLocale(locale);
    }
    return true;
  };
  const saveSettings = async (
    next: Settings,
    tagApprovals: Record<string, string> = {},
    propagate = false,
  ) => {
    setBusy(true);
    try {
      await api("settings", "PUT", { ...settingsPayload(next), tagApprovals });
      setTagChanges(null);
      setTagSaveReview(null);
      const settings = await api<Settings>("settings");
      setCfg(settings);
      await saved(settings);
      await setLocale(draftLocale);
      notify(t("Settings saved."));
    } catch (e) {
      if (propagate) throw e;
    } finally {
      setBusy(false);
    }
  };
  const submit = async (e: Event) => {
    e.preventDefault();
    const changes = instancesOf(cfg)
      .map((instance) =>
        tagTransition(
          instance.id,
          instanceByID(settings, instance.id) || {
            ...instance,
            tagSync: undefined,
          },
          instance,
        ),
      )
      .filter((c) => c.needsMode || c.disabled.length);
    if (changes.length) {
      setTagChanges(changes);
      return;
    }
    await saveSettings(cfg);
  };
  const confirmTags = async (choices: Record<string, TagDecision>) => {
    let next = structuredClone(cfg);
    for (const [service, choice] of Object.entries(choices)) {
      next = updateInstance(next, service, {
        ...(choice.mode ? { tagSyncMode: choice.mode } : {}),
        ...(choice.disable ? { tagSyncDisable: choice.disable } : {}),
      });
    }
    setBusy(true);
    try {
      const requests = Object.keys(choices).map((service) => ({
        service,
        config: instanceByID(next, service)!,
        instances: next.instances,
      }));
      const previews: TagPreview[] = [];
      for (const request of requests)
        previews.push(await api<TagPreview>("tag-preview", "POST", request));
      setCfg(next);
      setTagChanges(null);
      if (
        previews.some((p) =>
          p.rows.some((row) => row.assignments > 0 || row.deleteDefinition),
        )
      )
        setTagSaveReview({ next, requests, previews });
      else
        await saveSettings(
          next,
          Object.fromEntries(previews.map((p) => [p.service, p.token])),
        );
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return {
    cfg,
    setCfg,
    draftLocale,
    setDraftLocale,
    dirty,
    setRulesDirty,
    setCustomDirty,
    busy,
    section,
    confirmSectionChange,
    saveSettings,
    submit,
    confirmTags,
    tagChanges,
    setTagChanges,
    tagSaveReview,
    setTagSaveReview,
  };
}

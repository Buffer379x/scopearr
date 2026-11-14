import { useEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import type { BandStyle, Theme } from "../appearance";
import { confirmDiscard } from "../confirmation";
import { t, useI18n } from "../i18n";
import { instancesOf, instanceByID, updateInstance } from "../instances";
import { writeListPrefs, type ListPrefs } from "../list-prefs";
import { notify } from "../notifications";
import { settingsPayload } from "../settings-payload";
import {
  tagTransition,
  type TagDecision,
  type TagTransition,
} from "../tag-policy";
import type { TagPreview, TagReviewRequest } from "../components/TagReview";
import type { Settings } from "../types";
import { useListPrefs } from "./useListPrefs";

// The settings draft: unsaved changes, the leave guards (section change,
// beforeunload, onDirty for the app navigation) and saving with tag review.
// The interface language and the list preferences of this browser
// (list-prefs.ts: row density, stacked audio tracks) are drafts too; they
// are applied only after a successful save and never sent to the server.
// The navigation owns the section: the frame's section links ask the guard
// below (confirmSectionChange) through openLink, then open the section.
// Mode and accent band (Display) are drafts as well (ruling P1): `look`
// holds a changed half (undefined: unchanged), is never stored and goes to
// `appearance` only after a successful save. `theme` is the shown mode; a
// change of it (the topbar) clears the mode draft and keeps the rest.
export type Look = { mode?: Theme; band?: BandStyle | null };
export function useSettingsDraft({
  settings,
  section,
  onDirty,
  saved,
  theme,
  appearance,
}: {
  settings: Settings;
  section: string;
  onDirty: (dirty: boolean) => void;
  saved: (settings: Settings) => Promise<void>;
  theme?: Theme;
  appearance?: (next: Look) => void;
}) {
  const { locale, setLocale } = useI18n();
  const [draftLocale, setDraftLocale] = useState(locale);
  const savedPrefs = useListPrefs();
  const [draftPrefs, setDraftPrefs] = useState<ListPrefs>(savedPrefs);
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
  const [look, setLook] = useState<Look>({});
  // The shown mode is the base: a new one drops the mode draft (two modes,
  // so the drafted one equals it and no render shows a false change).
  const base = useRef(theme);
  if (base.current !== theme) {
    base.current = theme;
    if (look.mode) setLook(({ band }) => (band === undefined ? {} : { band }));
  }
  const lookDirty =
    (!!look.mode && look.mode !== theme) || look.band !== undefined;
  // The mode and band draft as it stands now: a save applies it when it
  // ends, so a topbar change during the save (which drops the mode draft)
  // is not undone by the mode drafted at submit.
  const current = useRef({ look, theme });
  current.current = { look, theme };

  const prefsDirty =
    draftPrefs.density !== savedPrefs.density ||
    draftPrefs.stacked !== savedPrefs.stacked;
  const dirty =
    JSON.stringify(cfg) !== JSON.stringify(settings) ||
    draftLocale !== locale ||
    prefsDirty ||
    lookDirty;
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
      setDraftPrefs(savedPrefs);
      setLook({});
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
      if (prefsDirty) writeListPrefs(draftPrefs);
      const now = current.current;
      if (
        (!!now.look.mode && now.look.mode !== now.theme) ||
        now.look.band !== undefined
      )
        appearance?.(now.look);
      setLook({});
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
    draftPrefs,
    setDraftPrefs,
    savedPrefs,
    look,
    setLook,
    mode: look.mode ?? theme,
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

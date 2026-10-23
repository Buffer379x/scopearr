import { canonicalToolPresetQuery } from "../tool-filters";
import { useEffect, useState } from "preact/hooks";
import { api, ApiError } from "../api";
import { confirmDeletion } from "../confirmation";
import { t } from "../i18n";
import { notify } from "../notifications";
import type { Preset } from "../types";
import { Modal } from "../components/Modal";

type ToolPreset = Omit<Preset, "service"> & { service: string };
export function useToolPresets(
  service: "tool:placement" | "tool:filecheck" | "tool:mux",
  query: URLSearchParams,
  apply: (q: URLSearchParams) => void,
  shares?: Record<string, number>,
) {
  const [presets, setPresets] = useState<ToolPreset[]>([]),
    [open, setOpen] = useState(false),
    [name, setName] = useState(""),
    [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const load = async () =>
    setPresets(
      (await api<ToolPreset[]>("presets")).filter((p) => p.service === service),
    );
  useEffect(() => {
    load().catch(() => {});
  }, [service]);
  const selectedPreset = presets.find(
    (p) =>
      canonicalToolPresetQuery(p.query) ===
      canonicalToolPresetQuery(query.toString()),
  );
  const reset = () => apply(new URLSearchParams());
  const applyPreset = (preset: ToolPreset) => {
    const q = new URLSearchParams(preset.query);
    q.delete("service");
    if (shares) {
      const valid = q.getAll("share").filter((s) => Object.hasOwn(shares, s));
      if (valid.length !== q.getAll("share").length) {
        q.delete("share");
        valid.forEach((s) => q.append("share", s));
        for (const name of new URLSearchParams(preset.query)
          .getAll("share")
          .filter((name) => !Object.hasOwn(shares, name)))
          notify(
            t("Share {name} is not present in the current scan.", { name }),
            "warning",
          );
      }
    }
    apply(q);
  };
  const remove = async () => {
    if (
      !selectedPreset ||
      !(await confirmDeletion(
        t("Delete preset “{name}”?", { name: selectedPreset.name }),
      ))
    )
      return;
    try {
      await api("presets?id=" + selectedPreset.id, "DELETE");
      await load();
      notify(t("Preset deleted."));
    } catch {}
  };
  const dialogs = open ? (
    <Modal title={t("Save filter view")} close={() => setOpen(false)}>
      <form
        onSubmit={async (e) => {
          e.preventDefault();
          setBusy(true);
          setError("");
          try {
            await api("presets", "POST", {
              name: name.trim(),
              service,
              query: query.toString(),
            });
            await load();
            setOpen(false);
            notify(t("Preset saved."));
          } catch (e) {
            setError(
              e instanceof ApiError && e.data.preset
                ? t("These filters are already saved as “{name}”.", {
                    name: e.data.preset.name,
                  })
                : (e as Error).message,
            );
          } finally {
            setBusy(false);
          }
        }}
      >
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <p class="quiet">
          {t("Saves list filters only. Scan options are unchanged.")}
        </p>
        <label>
          {t("Name")}
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        <div class="modal-actions">
          <button type="button" class="button" onClick={() => setOpen(false)}>
            {t("Cancel")}
          </button>
          <button class="button primary" disabled={busy || !name.trim()}>
            {t("Save preset")}
          </button>
        </div>
      </form>
    </Modal>
  ) : null;
  return {
    presets,
    selectedPreset,
    applyPreset,
    reset,
    savePreset: () => {
      setName("");
      setError("");
      setOpen(true);
    },
    deletePreset: remove,
    dialogs,
  };
}

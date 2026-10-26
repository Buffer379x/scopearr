import { useRef, useState } from "preact/hooks";
import { api } from "./api";
import { t } from "./i18n";
import { notify } from "./notifications";
import type { MediaFile } from "./types";

export function useMediaInfoRead(
  file: MediaFile,
  updated: (file: MediaFile) => void,
) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const pending = useRef(false);
  async function read() {
    if (pending.current) return;
    pending.current = true;
    setBusy(true);
    setError("");
    try {
      const next = await api<MediaFile>(
        "files/mediainfo",
        "POST",
        { service: file.service, fileId: file.id },
        undefined,
        { notifyErrors: false },
      );
      updated(next);
      notify(t("MediaInfo values saved."), "success");
    } catch (failure) {
      const message =
        failure instanceof Error ? failure.message : String(failure);
      setError(message);
      notify(message, "error");
    } finally {
      pending.current = false;
      setBusy(false);
    }
  }
  return { busy, error, read };
}

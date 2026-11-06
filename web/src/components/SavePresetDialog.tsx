import type { ComponentChildren } from "preact";
import { t } from "../i18n";
import { Modal } from "./Modal";

export function SavePresetDialog({
  description,
  name,
  setName,
  placeholder,
  error,
  submit,
  close,
  children,
}: {
  description: string;
  name: string;
  setName: (value: string) => void;
  placeholder?: string;
  error: string;
  submit: (e: Event) => void;
  close: () => void;
  children: ComponentChildren;
}) {
  return (
    <Modal title={t("Save filter view")} close={close}>
      <form onSubmit={submit}>
        {error && (
          <p class="error" role="alert">
            {error}
          </p>
        )}
        <p class="quiet">{description}</p>
        <label>
          {t("Name")}
          <input
            autoFocus
            required
            maxLength={80}
            value={name}
            placeholder={placeholder}
            onInput={(e) => setName(e.currentTarget.value)}
          />
        </label>
        {children}
      </form>
    </Modal>
  );
}

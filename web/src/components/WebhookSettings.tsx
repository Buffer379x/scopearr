import { Eye, EyeOff } from "lucide-preact";
import { useState } from "preact/hooks";
import type { Connection } from "../types";
import { t, useI18n } from "../i18n";
import { api } from "../api";
export function WebhookSettings({
  service,
  config,
  changed,
  savedEnabled,
  demo,
}: {
  service: string;
  config: Connection;
  changed: (patch: Partial<Connection>) => void;
  savedEnabled: boolean;
  demo: boolean;
}) {
  useI18n();
  const [credentials, setCredentials] = useState<{
    username: string;
    password: string;
    endpoint: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  return (
    <section class="webhook-settings">
      <h4>{t("Realtime updates")}</h4>
      <label class="check-field">
        <input
          type="checkbox"
          disabled={demo}
          checked={!!config.webhookEnabled}
          onChange={(e) => changed({ webhookEnabled: e.currentTarget.checked })}
        />
        {t("Enable webhook")}
      </label>
      <p class="quiet">
        {t(
          "Imports, upgrades and file deletions refresh affected entries. Regular sync remains the fallback. New media server stream metadata is added during the next full sync.",
        )}
      </p>
      <button
        class="button"
        type="button"
        disabled={demo || busy || !savedEnabled}
        onClick={async () => {
          setBusy(true);
          try {
            setCredentials(
              await api(
                "webhook-credentials?service=" + encodeURIComponent(service),
                "POST",
              ),
            );
          } catch {
          } finally {
            setBusy(false);
          }
        }}
      >
        {t("Show webhook connection")}
      </button>
      {credentials && (
        <div class="webhook-credentials">
          <label>
            {t("Webhook URL")}
            <input readOnly value={location.origin + credentials.endpoint} />
          </label>
          <label>
            {t("Username")}
            <input readOnly value={credentials.username} />
          </label>
          <label>
            {t("Password")}
            <span class="password-reveal-field">
              <input
                readOnly
                type={showPassword ? "text" : "password"}
                autoComplete="off"
                value={credentials.password}
              />
              <button
                type="button"
                class="icon-button password-reveal"
                title={t(showPassword ? "Hide password" : "Show password")}
                aria-label={t(showPassword ? "Hide password" : "Show password")}
                aria-pressed={showPassword}
                onClick={() => setShowPassword(!showPassword)}
              >
                {showPassword ? <EyeOff size={17} /> : <Eye size={17} />}
              </button>
            </span>
          </label>
          <small>
            {t(
              "In Radarr / Sonarr: Settings → Connect → Webhook. Method POST; enter these Basic authentication credentials. Enable On Import, On Upgrade and On File Delete, then Test and Save. Use a URL reachable from the service containers.",
            )}
          </small>
          <button
            type="button"
            class="button"
            onClick={() => {
              setCredentials(null);
              setShowPassword(false);
            }}
          >
            {t("Hide credentials")}
          </button>
        </div>
      )}
    </section>
  );
}

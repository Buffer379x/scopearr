import { useState } from "preact/hooks";
import type { Connection } from "../types";
import { t, useI18n } from "../i18n";
import { api } from "../api";
import { ServiceSection } from "./settings/ServiceCard";
import { field } from "./settings/Field";
import { check } from "./settings/Check";

// Realtime updates, a section of the library card (ruling R-K): the
// webhook switch, its 1.7.0 hint and, once saved, its connection (URL,
// username and the password with its reveal toggle, v2-reveal).
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
  const id = "webhook-" + service + "-";
  const reveal = t(showPassword ? "Hide password" : "Show password");
  return (
    <ServiceSection title={t("Realtime updates")}>
      {check(
        t("Enable webhook"),
        !!config.webhookEnabled,
        (webhookEnabled) => changed({ webhookEnabled }),
        demo,
      )}
      <small>
        {t(
          "Imports, upgrades and file deletions refresh affected entries. Regular sync remains the fallback. New media server stream metadata is added during the next full sync.",
        )}
      </small>
      <div class="v2-svc-actions">
        <button
          class="v2-btn v2-btn--sm"
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
      </div>
      {credentials && (
        <>
          <div class="v2-form">
            {(
              [
                ["url", "Webhook URL", location.origin + credentials.endpoint],
                ["user", "Username", credentials.username],
              ] as const
            ).map(([key, label, value]) =>
              field(
                id + key,
                t(label),
                (a) => <input {...a} class="v2-input" readOnly value={value} />,
                undefined,
                key,
              ),
            )}
            {field(id + "password", t("Password"), (a) => (
              <div class="v2-input-group">
                <input
                  {...a}
                  class="v2-input"
                  readOnly
                  type={showPassword ? "text" : "password"}
                  autoComplete="off"
                  value={credentials.password}
                />
                <button
                  type="button"
                  class="v2-icon-btn v2-icon-btn--sm v2-reveal"
                  title={reveal}
                  aria-label={reveal}
                  aria-pressed={showPassword}
                  aria-controls={id + "password"}
                  onClick={() => setShowPassword(!showPassword)}
                />
              </div>
            ))}
          </div>
          <small>
            {t(
              "In Radarr / Sonarr: Settings → Connect → Webhook. Method POST; enter these Basic authentication credentials. Enable On Import, On Upgrade and On File Delete, then Test and Save. Use a URL reachable from the service containers.",
            )}
          </small>
          <div class="v2-svc-actions">
            <button
              type="button"
              class="v2-btn v2-btn--sm"
              onClick={() => {
                setCredentials(null);
                setShowPassword(false);
              }}
            >
              {t("Hide credentials")}
            </button>
          </div>
        </>
      )}
    </ServiceSection>
  );
}

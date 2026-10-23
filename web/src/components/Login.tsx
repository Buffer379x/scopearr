import { ICON } from "../ui";
import { ArrowUpRight, LoaderCircle } from "lucide-preact";
import { useState } from "preact/hooks";
import { LanguageSelect, t, useI18n } from "../i18n";
import type { Status } from "../types";

import { api } from "../api";
export function Login({
  status,
  done,
  expired = false,
}: {
  status: Status;
  done: () => Promise<void>;
  expired?: boolean;
}) {
  useI18n();
  const [user, setUser] = useState(status.demo ? "demo" : ""),
    [password, setPassword] = useState(status.demo ? "Scopearr-demo-2026" : ""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false);
  const submit = async (e: Event) => {
    e.preventDefault();
    setBusy(true);
    try {
      await api(status.initialized ? "login" : "setup", "POST", {
        username: user,
        password,
        token,
      });
      await done();
    } catch {
    } finally {
      setBusy(false);
    }
  };
  return (
    <main class="login-page">
      <div class="login-art">
        <div class="login-orbit" />
        <img src="/icon-1024.png" alt={t("Scopearr icon")} />
      </div>
      <div class="login-form">
        <LanguageSelect />
        <div class="brand">
          <img
            src="/icon-64.png"
            srcSet="/icon-64.png 1x, /icon-256.png 2x"
            width="34"
            height="34"
            alt=""
          />
          <b>
            Scopearr<span> / </span>
          </b>
        </div>
        <h2>
          {status.initialized
            ? t("Welcome back.")
            : t("Your library starts here.")}
        </h2>
        <p>
          {status.initialized
            ? t("Sign in to explore your library.")
            : t("Create your local admin account, then connect your services.")}
        </p>
        {expired && (
          <p class="notice" role="status">
            {t("Your session expired. Sign in again.")}
          </p>
        )}
        {status.demo && (
          <div class="notice">
            {t("Interactive demo with sample data. Credentials are prefilled.")}
          </div>
        )}
        <form onSubmit={submit}>
          {!status.initialized && (
            <label>
              {t("Setup code")}
              <input
                value={token}
                onInput={(e) => setToken(e.currentTarget.value)}
                required
                autoComplete="off"
              />
              <small>
                {t(
                  "Copy the one-time code from /data/setup-token in the container console.",
                )}
              </small>
            </label>
          )}
          <label>
            {t("Username")}
            <input
              value={user}
              onInput={(e) => setUser(e.currentTarget.value)}
              autoComplete="username"
              required
            />
          </label>
          <label>
            {t("Password")}
            <input
              type="password"
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autoComplete={
                status.initialized ? "current-password" : "new-password"
              }
              minLength={status.initialized ? undefined : 12}
              required
            />
            {!status.initialized && (
              <small>
                {t("At least 12 characters, at most 72 UTF-8 bytes.")}
              </small>
            )}
          </label>

          <button type="submit" class="primary" disabled={busy}>
            {busy ? (
              <LoaderCircle class="spin" size={ICON.label} />
            ) : (
              <ArrowUpRight size={ICON.label} />
            )}{" "}
            {status.initialized ? t("Sign in") : t("Create account")}
          </button>
        </form>
        <div class="quiet login-version">
          Scopearr {status.version}
          {t("· For your own server")}
        </div>
      </div>
    </main>
  );
}

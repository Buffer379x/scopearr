import { ArrowUpRight, LoaderCircle } from "lucide-preact";
import { useLayoutEffect, useRef, useState } from "preact/hooks";
import { api } from "../api";
import { LanguageSelect, t, useI18n } from "../i18n";
import type { Status } from "../types";
import { ICON } from "../ui";

// Sign-in and, on an uninitialized instance, setup (docs/STYLEGUIDE.md,
// Part 1, 11.5): the band with the app icon, the card with the form and the
// footer. The icon's box is set before it loads, so nothing moves.
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
  const setup = !status.initialized;
  const [user, setUser] = useState(status.demo ? "demo" : ""),
    [password, setPassword] = useState(status.demo ? "Scopearr-demo-2026" : ""),
    [token, setToken] = useState(""),
    [busy, setBusy] = useState(false),
    [shown, setShown] = useState(false);
  const reveal = t("Show password");
  // Chromium on Linux and Windows puts the caret at the start when a field
  // changes its type; the toggle keeps the selection where it was.
  const passwordRef = useRef<HTMLInputElement>(null),
    selection = useRef<
      [number | null, number | null, "forward" | "backward" | "none"] | null
    >(null);
  const toggleShown = () => {
    const input = passwordRef.current;
    selection.current =
      input && document.activeElement === input
        ? [
            input.selectionStart,
            input.selectionEnd,
            input.selectionDirection ?? "none",
          ]
        : null;
    setShown(!shown);
  };
  useLayoutEffect(() => {
    const input = passwordRef.current,
      saved = selection.current;
    selection.current = null;
    if (!input || !saved || saved[0] === null || saved[1] === null) return;
    // The field resets its caret when its layout is rebuilt for the new
    // type; reading its width rebuilds it now, so the restore stays.
    void input.offsetWidth;
    input.setSelectionRange(saved[0], saved[1], saved[2]);
  }, [shown]);
  const submit = async (e: Event) => {
    e.preventDefault();
    // Password managers save what a password field holds.
    setShown(false);
    setBusy(true);
    try {
      await api(setup ? "setup" : "login", "POST", {
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
    <main class="v2-login">
      <div class="v2-login-band">
        <img
          src="/icon.svg?v=2.0.0"
          width={72}
          height={72}
          alt={t("Scopearr icon")}
        />
        <h1>Scopearr</h1>
        <p>{t("Your movie and TV library. Clearly filtered.")}</p>
      </div>
      <form class="v2-card v2-login-card" onSubmit={submit}>
        <div class="v2-login-head">
          <h2>{setup ? t("Your library starts here.") : t("Welcome back.")}</h2>
          <LanguageSelect />
        </div>
        <p class="v2-login-text">
          {setup
            ? t("Create your local admin account, then connect your services.")
            : t("Sign in to explore your library.")}
        </p>
        {expired && (
          <p class="v2-notice v2-notice--warn" role="status">
            {t("Your session expired. Sign in again.")}
          </p>
        )}
        {status.demo && (
          <p class="v2-notice">
            {t("Interactive demo with sample data. Credentials are prefilled.")}
          </p>
        )}
        {setup && (
          <div class="v2-field">
            <label for="v2-login-token">{t("Setup code")}</label>
            <input
              id="v2-login-token"
              class="v2-input v2-input--lg"
              value={token}
              onInput={(e) => setToken(e.currentTarget.value)}
              required
              autoComplete="off"
              aria-describedby="v2-login-token-hint"
            />
            <small id="v2-login-token-hint">
              {t(
                "Copy the one-time code from /data/setup-token in the container console.",
              )}
            </small>
          </div>
        )}
        <div class="v2-field">
          <label for="v2-login-user">{t("Username")}</label>
          <input
            id="v2-login-user"
            class="v2-input v2-input--lg"
            value={user}
            onInput={(e) => setUser(e.currentTarget.value)}
            autoComplete="username"
            required
          />
        </div>
        <div class="v2-field">
          <label for="v2-login-password">{t("Password")}</label>
          <div class="v2-input-group">
            <input
              id="v2-login-password"
              ref={passwordRef}
              class="v2-input v2-input--lg"
              type={shown ? "text" : "password"}
              value={password}
              onInput={(e) => setPassword(e.currentTarget.value)}
              autoComplete={setup ? "new-password" : "current-password"}
              minLength={setup ? 12 : undefined}
              required
              aria-describedby={setup ? "v2-login-password-hint" : undefined}
            />
            {/* Ruling R-A: a toggle with a fixed name, its state in
                aria-pressed; a press keeps focus and the caret in the
                field; the recipe draws its eye (v2-reveal). */}
            <button
              type="button"
              class="v2-icon-btn v2-icon-btn--sm v2-reveal"
              aria-label={reveal}
              title={reveal}
              aria-pressed={shown}
              aria-controls="v2-login-password"
              onMouseDown={(e) => e.preventDefault()}
              onClick={toggleShown}
            />
          </div>
          {setup && (
            <small id="v2-login-password-hint">
              {t("At least 12 characters, at most 72 UTF-8 bytes.")}
            </small>
          )}
        </div>
        <button
          type="submit"
          class="v2-btn v2-btn--primary v2-btn--lg"
          disabled={busy}
        >
          {busy ? (
            <LoaderCircle class="v2-spin" size={ICON.label} />
          ) : (
            <ArrowUpRight size={ICON.label} />
          )}
          {setup ? t("Create account") : t("Sign in")}
        </button>
      </form>
      <p class="v2-login-foot">
        Scopearr {status.version} {t("· For your own server")}
      </p>
    </main>
  );
}

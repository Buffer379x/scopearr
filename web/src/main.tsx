import { render } from "preact";
import { lazy, Suspense } from "preact/compat";
import { applyAppearance, storedTheme } from "./appearance";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
import { LoadingScreen } from "./components/LoadingScreen";
import { Login } from "./components/Login";
import { Notifications } from "./components/Notifications";
import { useStatus } from "./hooks/useStatus";
import {
  I18nProvider,
  initialLocale,
  loadLocale,
  prepareLocale,
  t,
  useI18n,
} from "./i18n";
import "./style.css";
import { installPreloadRecovery } from "./preload-recovery";
installPreloadRecovery();
const Library = lazy(() =>
  import("./components/Library").then((module) => ({
    default: module.Library,
  })),
);
function App() {
  useI18n();
  const { status, error, refresh, disconnected, expired } = useStatus();
  const loading = <LoadingScreen message={error} />;
  if (!status) return loading;
  if (!status.authenticated)
    return <Login status={status} done={refresh} expired={expired} />;
  return (
    <Suspense fallback={loading}>
      {/* Fixed over the topbar, so it moves nothing (E29). */}
      {disconnected && (
        <p class="v2-offline" role="status">
          {t("Connection to Scopearr interrupted – trying again …")}
        </p>
      )}
      <Library status={status} refresh={refresh} />
    </Suspense>
  );
}
// Waits for the v2 typeface before the first render, at most `timeout` ms.
// tool-table.ts measures header widths with the body font, so a render before
// the face arrives would size columns with the fallback. The family comes from
// --font (layer tokens); the stylesheet blocks this module, so it is set. A
// missing face or an unknown value renders with the fallback stack.
function fontsReady(timeout = 1000): Promise<void> {
  const family = getComputedStyle(document.documentElement)
    .getPropertyValue("--font")
    .trim();
  if (!family || !document.fonts) return Promise.resolve();
  let timer = 0;
  return Promise.race([
    document.fonts.load("1em " + family).then(
      () => undefined,
      () => undefined,
    ),
    new Promise<void>((resolve) => {
      timer = window.setTimeout(resolve, timeout);
    }),
  ]).finally(() => window.clearTimeout(timer));
}
// Theme and band for sign-in, setup, the loading screen and the app, before
// anything renders (appearance.ts).
applyAppearance(document.documentElement, storedTheme());
Promise.all([
  loadLocale(initialLocale()).catch(() => loadLocale("en")),
  fontsReady(),
]).then(([catalog]) => {
  prepareLocale(catalog);
  render(
    <I18nProvider>
      <Notifications />
      <ConfirmationDialog />
      <App />
    </I18nProvider>,
    document.getElementById("app")!,
  );
});

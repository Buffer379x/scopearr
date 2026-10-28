import { ICON } from "./ui";
import { LoaderCircle } from "lucide-preact";
import { render } from "preact";
import { lazy, Suspense } from "preact/compat";
import { ConfirmationDialog } from "./components/ConfirmationDialog";
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
  const loading = (
    <div class="loading-screen">
      <img src="/icon-256.png" alt="" />
      <LoaderCircle class="spin" size={ICON.empty} />
      <p>{error || t("Loading Scopearr …")}</p>
    </div>
  );
  if (!status) return loading;
  if (!status.authenticated)
    return <Login status={status} done={refresh} expired={expired} />;
  return (
    <Suspense fallback={loading}>
      {disconnected && (
        <p class="notice connection-notice" role="status">
          {t("Connection to Scopearr interrupted – trying again …")}
        </p>
      )}
      <Library status={status} refresh={refresh} />
    </Suspense>
  );
}
loadLocale(initialLocale())
  .catch(() => loadLocale("en"))
  .then((catalog) => {
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

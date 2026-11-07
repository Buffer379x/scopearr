import { LoaderCircle } from "lucide-preact";
import { t } from "../i18n";
import { ICON } from "../ui";

// The loading screen of the start and of the shell until the first settings
// answer (docs/STYLEGUIDE.md, Part 1, 10.1). `message` replaces the loading
// text, such as a status error.
export function LoadingScreen({ message }: { message?: string }) {
  return (
    <div class="loading-screen">
      <img src="/icon-256.png" alt="" />
      <LoaderCircle class="spin" size={ICON.empty} />
      <p>{message || t("Loading Scopearr …")}</p>
    </div>
  );
}

import { LoaderCircle } from "lucide-preact";
import { t } from "../i18n";
import { ICON } from "../ui";

// The loading screen of the start and of the shell until the first settings
// answer (docs/STYLEGUIDE.md, Part 1, 10.8): the icon where the sign-in band
// shows it, so sign-in follows without a jump, and a spinner on --bg.
// `message` replaces the loading text, such as a status error.
export function LoadingScreen({ message }: { message?: string }) {
  return (
    <div class="v2-loading">
      <img src="/icon.svg?v=2.0.0" width={72} height={72} alt="" />
      <LoaderCircle class="v2-spin" size={ICON.empty} />
      <p>{message || t("Loading Scopearr …")}</p>
    </div>
  );
}

import { ICON, Tooltip } from "../ui";
import { TagColors, TagVisibility, TagInformation } from "../ui";
import { useContext } from "preact/hooks";
import { Languages } from "lucide-preact";
import { t, useI18n, getLocale } from "../i18n";
import { audioLanguage, audioLanguageLabel } from "../languages";
const horizontal: Record<string, string[]> = {
  de: ["#151515", "#dc2525", "#f8ce38"],
  es: ["#b81c31", "#f6cc3a", "#b81c31"],
  nl: ["#bf2737", "#fff", "#21468b"],
  ru: ["#fff", "#2865bb", "#d72e36"],
  pl: ["#fff", "#dc2848"],
};
const vertical: Record<string, string[]> = {
  it: ["#009246", "#fff", "#ce2b37"],
  fr: ["#0055a4", "#fff", "#ef4135"],
  pt: ["#006600", "#d42628"],
};
export function LanguageFlag({
  value,
  focusable = true,
  colors,
}: {
  value: string;
  focusable?: boolean;
  colors?: Record<string, string>;
}) {
  useI18n();
  const language = audioLanguage(value),
    label = t(audioLanguageLabel(value, getLocale()));
  const flag = language?.flag;
  const inherited = useContext(TagColors),
    visibility = useContext(TagVisibility),
    information = useContext(TagInformation);
  const enabled =
    !(information.language || []).includes(value) &&
    (!visibility ||
      !Object.hasOwn(visibility, "language") ||
      (visibility.language || []).includes(value));
  const color = (colors || inherited)["language:" + value];
  const edge =
    flag && enabled && /^#[0-9a-f]{6}$/i.test(color || "") ? color : undefined;
  const renderedFlag = (
    <span
      class={"language-flag" + (flag ? " known-language" : "")}
      role="img"
      aria-label={label}
      tabIndex={focusable ? 0 : undefined}
    >
      {flag &&
      ![
        "de",
        "gb",
        "es",
        "it",
        "fr",
        "jp",
        "pt",
        "nl",
        "ru",
        "pl",
        "tr",
      ].includes(flag) ? (
        <img src={"/flags/" + flag + ".svg"} alt="" aria-hidden="true" />
      ) : flag ? (
        <svg
          viewBox="0 0 30 20"
          aria-hidden="true"
          focusable="false"
          style={edge ? { boxShadow: `0 0 0 1px ${edge}` } : undefined}
        >
          {horizontal[flag]?.map((color, i, colors) => (
            <rect
              key={i}
              x="0"
              y={flag === "es" ? [0, 5, 15][i] : (i * 20) / colors.length}
              width="30"
              height={flag === "es" ? [5, 10, 5][i] : 20 / colors.length}
              fill={color}
            />
          ))}
          {vertical[flag]?.map((color, i, colors) => (
            <rect
              key={i}
              x={(i * 30) / colors.length}
              y="0"
              width={30 / colors.length}
              height="20"
              fill={color}
            />
          ))}
          {flag === "tr" && (
            <>
              <rect width="30" height="20" fill="#e30a17" />
              <circle cx="11" cy="10" r="5" fill="#fff" />
              <circle cx="12.5" cy="10" r="4" fill="#e30a17" />
              <path
                d="M18 6.5L18.9 8.8L21.4 9L19.5 10.6L20.1 13L18 11.6L15.9 13L16.5 10.6L14.6 9L17.1 8.8Z"
                fill="#fff"
              />
            </>
          )}
          {flag === "jp" && (
            <>
              <rect width="30" height="20" fill="#fff" />
              <circle cx="15" cy="10" r="6" fill="#bc002d" />
            </>
          )}
          {flag === "gb" && (
            <>
              <rect width="30" height="20" fill="#17427e" />
              <path d="M0 0L30 20M30 0L0 20" stroke="#fff" stroke-width="5" />
              <path
                d="M0 0L30 20M30 0L0 20"
                stroke="#cc2436"
                stroke-width="2"
              />
              <path d="M15 0V20M0 10H30" stroke="#fff" stroke-width="7" />
              <path d="M15 0V20M0 10H30" stroke="#cc2436" stroke-width="4" />
            </>
          )}
          {flag === "pt" && (
            <circle
              cx="15"
              cy="10"
              r="3.5"
              fill="#f2cb3d"
              stroke="#fff"
              stroke-width="1"
            />
          )}
        </svg>
      ) : (
        <Languages size={ICON.button} />
      )}
    </span>
  );
  return focusable ? (
    <Tooltip content={label}>{renderedFlag}</Tooltip>
  ) : (
    renderedFlag
  );
}
export function LanguageFlags({ value }: { value: string }) {
  useI18n();
  return (
    <span class="language-flags">
      {(value
        ? value
            .split(/[,;/|]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [""]
      ).map((language, i) => (
        <LanguageFlag key={language + ":" + i} value={language} />
      ))}
    </span>
  );
}

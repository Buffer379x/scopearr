// The in-app brand (docs/STYLEGUIDE.md, Part 1, 12): the magnifier with the
// funnel of the app icon, without its dots, in one color. It draws in
// currentColor, so the frame colors it with --accent of the active palette.
// The geometry is the approved design's mark (32 × 32). It is decorative:
// the link around it carries the name.
export function BrandMark({
  size = 32,
  class: className,
}: {
  size?: number;
  class?: string;
}) {
  return (
    <svg
      class={className}
      viewBox="0 0 32 32"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M8.9 9.2H18.1L14.7 13.4V17.6L12.3 19V13.4Z"
        fill="currentColor"
        stroke="currentColor"
        stroke-width="0.8"
        stroke-linejoin="round"
      />
      <circle
        cx="13.5"
        cy="13.5"
        r="9"
        stroke="currentColor"
        stroke-width="3.2"
      />
      <path
        d="M20.4 20.4L27 27"
        stroke="currentColor"
        stroke-width="4.2"
        stroke-linecap="round"
      />
    </svg>
  );
}

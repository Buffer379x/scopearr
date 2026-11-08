export function colorStyle(color: string | undefined, textColor?: string) {
  const foreground =
    textColor === "#000000" || textColor === "#ffffff" ? textColor : undefined;
  if (!color || !/^#[0-9a-f]{6}$/i.test(color))
    return foreground ? { color: foreground } : undefined;
  const rgb = [1, 3, 5]
    .map((i) => parseInt(color.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  const luminance = rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
  const border =
    "#" +
    [1, 3, 5]
      .map((i) =>
        Math.round(parseInt(color.slice(i, i + 2), 16) * 0.7)
          .toString(16)
          .padStart(2, "0"),
      )
      .join("");
  return {
    "--tag-border": border,
    backgroundColor: color,
    borderColor: border,
    color:
      foreground ||
      ((luminance + 0.05) / 0.05 >= 1.05 / (luminance + 0.05)
        ? "#000000"
        : "#ffffff"),
  };
}
// A user color on a v2 tag or track chip segment (docs/STYLEGUIDE.md,
// Part 1, 2.5): only the background and the text color inline, the text the
// user's or black or white by luminance, never 1.7.0's --tag-border.
export function userColorStyle(color?: string, textColor?: string) {
  const style = colorStyle(color, textColor);
  if (!style) return undefined;
  return "backgroundColor" in style
    ? { backgroundColor: style.backgroundColor, color: style.color }
    : { color: style.color };
}

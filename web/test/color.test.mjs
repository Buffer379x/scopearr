import test from "node:test";
import assert from "node:assert/strict";
import { colorStyle } from "../src/color.ts";
const luminance = (hex) => {
  const rgb = [1, 3, 5]
    .map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map((c) => (c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return rgb[0] * 0.2126 + rgb[1] * 0.7152 + rgb[2] * 0.0722;
};
test("custom colors including middle gray retain readable text contrast", () => {
  assert.equal(colorStyle("#777777").color, "#000000");
  for (let r = 0; r <= 255; r += 17)
    for (let g = 0; g <= 255; g += 17)
      for (let b = 0; b <= 255; b += 17) {
        const hex =
          "#" + [r, g, b].map((c) => c.toString(16).padStart(2, "0")).join("");
        const style = colorStyle(hex),
          bg = luminance(hex),
          fg = luminance(style.color);
        assert.ok(
          (Math.max(bg, fg) + 0.05) / (Math.min(bg, fg) + 0.05) >= 4.5,
          hex,
        );
      }
});
test("invalid custom colors do not reach inline styles", () => {
  for (const value of [undefined, "red", "#fff", "#ffffff;display:none"])
    assert.equal(colorStyle(value), undefined);
});
test("custom tag borders and hover outlines retain the selected hue", () => {
  const style = colorStyle("#85bce5");
  assert.equal(style.borderColor, "#5d84a0");
  assert.equal("--tag-border" in style, false);
  assert.notEqual(style.borderColor, style.backgroundColor);
  assert.notEqual(style.borderColor, style.color);
});
test("explicit black or white text overrides automatic contrast independently of background", () => {
  assert.equal(colorStyle("#ffffff", "#ffffff").color, "#ffffff");
  assert.equal(colorStyle("#000000", "#000000").color, "#000000");
  assert.deepEqual(colorStyle(undefined, "#ffffff"), { color: "#ffffff" });
  assert.equal(colorStyle(undefined, "red"), undefined);
  assert.equal(colorStyle("#85bce5", "red").color, "#000000");
  assert.equal(colorStyle("#85bce5", "#ffffff").borderColor, "#5d84a0");
});

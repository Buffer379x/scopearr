// Writes the app icon files that web/public ships, from the SVG master
// web/public/icon.svg (docs/STYLEGUIDE.md, Part 1, 12). Run after changing
// the master:
//   node web/scripts/icons.mjs [--out <dir>]
// --out writes into another directory (relative to the working directory),
// e.g. to compare two runs; the default is web/public.
// Chromium comes from SCOPEARR_E2E_CHROME when set, otherwise from the
// Playwright installation of the e2e tests; there is no further dependency.
// - icon-64.png, icon-256.png, icon-1024.png: the template, Compose and the
//   interface use them.
// - favicon.png (64) and apple-touch-icon.png (180).
// - favicon.ico: PNG entries of 16, 32, 48 and 64, in a container written
//   here.
// Each size is rasterized from the vector master with a transparent
// background, so the corners outside the squircle stay transparent. Only the
// Apple touch icon is full-bleed: iOS applies its own mask and would show
// transparent pixels black, so the tile's gradient and sheen fill the whole
// square there. The same master and Chromium give the same bytes.
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { chromium } from "@playwright/test";

const publicDir = new URL("../public/", import.meta.url);
const outArg = process.argv.indexOf("--out");
const outDir =
  outArg < 0
    ? publicDir
    : pathToFileURL(process.argv[outArg + 1].replace(/\/?$/, "/"));
mkdirSync(outDir, { recursive: true });

const master = readFileSync(new URL("icon.svg", publicDir), "utf8");
// The two squircle layers (gradient, sheen) become squares of the full
// canvas; the glyph stays where it is, inside the iOS mask.
const squircle = /<path d="M160 16H352[^"]*" (fill="url\(#sq-[a-z]+\)")\/>/g;
const fullBleed = master.replace(
  squircle,
  '<rect width="512" height="512" $1/>',
);
if (master.match(squircle)?.length !== 2)
  throw new Error("icon.svg: expected the two squircle layers");

const svgSource = (svg) =>
  "data:image/svg+xml;base64," + Buffer.from(svg).toString("base64");
const renders = [
  ...[16, 32, 48, 64, 256, 1024].map((size) => [size, svgSource(master)]),
  ["touch", svgSource(fullBleed), 180],
];

const browser = await chromium.launch({
  executablePath: process.env.SCOPEARR_E2E_CHROME || undefined,
});
const rendered = new Map();
try {
  for (const [key, source, size = key] of renders) {
    const page = await browser.newPage({
      viewport: { width: size, height: size },
      deviceScaleFactor: 1,
    });
    await page.setContent(
      `<!doctype html><style>html,body{margin:0;background:transparent}` +
        `img{display:block}</style>` +
        `<img src="${source}" width="${size}" height="${size}" alt="">`,
    );
    await page.locator("img").evaluate((img) => img.decode());
    rendered.set(
      key,
      await page.screenshot({ omitBackground: true, type: "png" }),
    );
    await page.close();
  }
} finally {
  await browser.close();
}

// ICONDIR (reserved, type 1 = icon, count), one 16-byte ICONDIRENTRY per
// image (width, height, colors, reserved, planes, bits per pixel, size,
// offset), then the PNG images in the same order.
function ico(sizes) {
  const images = sizes.map((size) => rendered.get(size));
  const header = Buffer.alloc(6 + 16 * images.length);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length;
  images.forEach((image, i) => {
    const at = 6 + 16 * i;
    header[at] = sizes[i];
    header[at + 1] = sizes[i];
    header.writeUInt16LE(1, at + 4);
    header.writeUInt16LE(32, at + 6);
    header.writeUInt32LE(image.length, at + 8);
    header.writeUInt32LE(offset, at + 12);
    offset += image.length;
  });
  return Buffer.concat([header, ...images]);
}

const files = {
  "icon-64.png": rendered.get(64),
  "icon-256.png": rendered.get(256),
  "icon-1024.png": rendered.get(1024),
  "favicon.png": rendered.get(64),
  "apple-touch-icon.png": rendered.get("touch"),
  "favicon.ico": ico([16, 32, 48, 64]),
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(name, outDir), bytes);
  console.log(`${name}: ${bytes.length} B`);
}

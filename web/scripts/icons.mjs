// Writes the app icon files that web/public ships, from the SVG master
// web/public/icon.svg (docs/STYLEGUIDE.md, Part 1, 12). Run after changing
// the master:
//   node web/scripts/icons.mjs
// Chromium comes from SCOPEARR_E2E_CHROME when set, otherwise from the
// Playwright installation of the e2e tests; there is no further dependency.
// - icon-64.png, icon-256.png, icon-1024.png: the template, Compose and the
//   interface use them.
// - favicon.png (64) and apple-touch-icon.png (180).
// - favicon.ico: PNG entries of 16, 32, 48 and 64, in a container written
//   here.
// Each size is rasterized from the vector master with a transparent
// background, so the corners outside the squircle stay transparent. The same
// master and Chromium give the same bytes.
import { readFileSync, writeFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const publicDir = new URL("../public/", import.meta.url);
const master = readFileSync(new URL("icon.svg", publicDir));
const source = "data:image/svg+xml;base64," + master.toString("base64");

const browser = await chromium.launch({
  executablePath: process.env.SCOPEARR_E2E_CHROME || undefined,
});
const rendered = new Map();
try {
  for (const size of [16, 32, 48, 64, 180, 256, 1024]) {
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
      size,
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
  "apple-touch-icon.png": rendered.get(180),
  "favicon.ico": ico([16, 32, 48, 64]),
};
for (const [name, bytes] of Object.entries(files)) {
  writeFileSync(new URL(name, publicDir), bytes);
  console.log(`${name}: ${bytes.length} B`);
}

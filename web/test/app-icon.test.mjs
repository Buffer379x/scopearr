import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import { inflateSync } from "node:zlib";

// The app icon (V8, docs/STYLEGUIDE.md Part 1, 12): one SVG master in
// web/public and the PNG and ICO files that web/scripts/icons.mjs derives
// from it. The template, Compose and index.html reference them with the
// 2.0.0 cache key. The Apple touch icon fills its whole square, since iOS
// masks it itself and shows transparent pixels black; every other file keeps
// the transparent corners of the squircle.

const repo = (path) => new URL("../../" + path, import.meta.url);
const read = (path) => readFileSync(repo(path), "utf8");
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

// Width, height and color type from the IHDR chunk that follows the signature.
function pngHeader(bytes, label) {
  assert.ok(bytes.subarray(0, 8).equals(PNG), label + " is a PNG");
  assert.equal(bytes.toString("latin1", 12, 16), "IHDR", label + " IHDR");
  return {
    width: bytes.readUInt32BE(16),
    height: bytes.readUInt32BE(20),
    colorType: bytes[25],
  };
}

// The alpha of the four corner pixels of an 8-bit RGBA (color type 6) or RGB
// (2, no alpha channel, so every pixel is opaque) PNG: concatenated IDAT
// data, inflated, then each scanline unfiltered (PNG filters 0 to 4).
function cornerAlphas(bytes, label) {
  const { width, height, colorType } = pngHeader(bytes, label);
  assert.ok(colorType === 6 || colorType === 2, label + " is RGBA or RGB");
  const channels = colorType === 6 ? 4 : 3;
  assert.equal(bytes[24], 8, label + " has 8 bits per channel");
  assert.equal(bytes[28], 0, label + " is not interlaced");
  const idat = [];
  for (let at = 8; at < bytes.length;) {
    const length = bytes.readUInt32BE(at);
    if (bytes.toString("latin1", at + 4, at + 8) === "IDAT")
      idat.push(bytes.subarray(at + 8, at + 8 + length));
    at += 12 + length;
  }
  const data = inflateSync(Buffer.concat(idat));
  const stride = width * channels;
  const rows = [];
  let previous = Buffer.alloc(stride);
  for (let y = 0; y < height; y++) {
    const filter = data[y * (stride + 1)];
    const line = Buffer.from(
      data.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1)),
    );
    for (let x = 0; x < stride; x++) {
      const a = x >= channels ? line[x - channels] : 0,
        b = previous[x],
        c = x >= channels ? previous[x - channels] : 0;
      const p = a + b - c,
        pa = Math.abs(p - a),
        pb = Math.abs(p - b),
        pc = Math.abs(p - c);
      const predictor = [
        0,
        a,
        b,
        (a + b) >> 1,
        pa <= pb && pa <= pc ? a : pb <= pc ? b : c,
      ][filter];
      line[x] = (line[x] + predictor) & 0xff;
    }
    rows.push(line);
    previous = line;
  }
  const alpha = (x, y) => (channels === 4 ? rows[y][x * 4 + 3] : 255);
  return [
    alpha(0, 0),
    alpha(width - 1, 0),
    alpha(0, height - 1),
    alpha(width - 1, height - 1),
  ];
}

// The PNG images inside favicon.ico, by directory size.
function icoImages(ico) {
  return Array.from({ length: ico.readUInt16LE(4) }, (_, i) => {
    const at = 6 + 16 * i;
    const offset = ico.readUInt32LE(at + 12);
    return [ico[at], ico.subarray(offset, offset + ico.readUInt32LE(at + 8))];
  });
}

test("the icon master has no perforation dots", () => {
  const svg = read("web/public/icon.svg");
  // Glass and rim; the dots of earlier drafts would add more circles.
  assert.equal(svg.match(/<circle\b/g)?.length, 2);
  const background =
    /<linearGradient id="sq-bg"[^>]*>([\s\S]*?)<\/linearGradient>/.exec(svg);
  assert.ok(background, "the squircle gradient exists");
  assert.deepEqual(
    [...background[1].matchAll(/stop-color="([^"]+)"/g)].map((m) => m[1]),
    ["#7ee4c5", "#3fae8f", "#14755c"],
  );
  assert.match(svg, /fill="url\(#sq-bg\)"/);
  assert.match(svg, /<title>Scopearr<\/title>/);
});

test("every derived icon has its size", () => {
  // Color type 6 is RGBA, with an alpha channel for the corners. The
  // full-bleed touch icon is opaque, so Chromium writes it as RGB (2).
  for (const [name, size, colorType] of [
    ["icon-64.png", 64, 6],
    ["icon-256.png", 256, 6],
    ["icon-1024.png", 1024, 6],
    ["favicon.png", 64, 6],
    ["apple-touch-icon.png", 180, 2],
  ]) {
    const path = "web/public/" + name;
    assert.ok(existsSync(repo(path)), path + " exists");
    assert.deepEqual(pngHeader(readFileSync(repo(path)), name), {
      width: size,
      height: size,
      colorType,
    });
  }

  const ico = readFileSync(repo("web/public/favicon.ico"));
  assert.equal(ico.readUInt16LE(0), 0, "ICO reserved");
  assert.equal(ico.readUInt16LE(2), 1, "ICO type icon");
  assert.equal(ico.readUInt16LE(4), 4, "ICO entries");
  const entries = [];
  let end = 6 + 16 * 4;
  for (let i = 0; i < 4; i++) {
    const at = 6 + 16 * i;
    const width = ico[at],
      height = ico[at + 1],
      bytes = ico.readUInt32LE(at + 8),
      offset = ico.readUInt32LE(at + 12);
    assert.equal(ico.readUInt16LE(at + 4), 1, "ICO planes");
    assert.equal(ico.readUInt16LE(at + 6), 32, "ICO bits per pixel");
    assert.equal(offset, end, "ICO images follow each other");
    end = offset + bytes;
    const image = ico.subarray(offset, end);
    assert.deepEqual(pngHeader(image, "favicon.ico " + width), {
      width,
      height,
      colorType: 6,
    });
    entries.push([width, height]);
  }
  assert.equal(end, ico.length, "ICO has no trailing bytes");
  assert.deepEqual(entries, [
    [16, 16],
    [32, 32],
    [48, 48],
    [64, 64],
  ]);
});

test("only the Apple touch icon fills its corners", () => {
  const png = (name) => readFileSync(repo("web/public/" + name));
  assert.deepEqual(
    cornerAlphas(png("apple-touch-icon.png"), "apple-touch-icon.png"),
    [255, 255, 255, 255],
  );
  for (const name of [
    "icon-64.png",
    "icon-256.png",
    "icon-1024.png",
    "favicon.png",
  ])
    assert.deepEqual(cornerAlphas(png(name), name), [0, 0, 0, 0], name);
  const images = icoImages(png("favicon.ico"));
  assert.equal(images.length, 4);
  for (const [size, image] of images)
    assert.deepEqual(
      cornerAlphas(image, "favicon.ico " + size),
      [0, 0, 0, 0],
      "favicon.ico " + size,
    );
});

test("icon links carry the 2.0.0 cache key", () => {
  const html = read("web/index.html");
  const links = [...html.matchAll(/<link\b[^>]*>/g)].map((m) => m[0]);
  const icons = links.filter((link) =>
    /rel="(icon|apple-touch-icon)"/.test(link),
  );
  assert.deepEqual(
    icons.map((link) => /href="([^"]+)"/.exec(link)?.[1]),
    [
      "/favicon.ico?v=2.0.0",
      "/favicon.png?v=2.0.0",
      "/icon.svg?v=2.0.0",
      "/apple-touch-icon.png?v=2.0.0",
    ],
  );
  const svg = icons.find((link) => link.includes("/icon.svg"));
  assert.match(svg, /rel="icon"/);
  assert.match(svg, /type="image\/svg\+xml"/);
  const touch = icons.find((link) => link.includes('rel="apple-touch-icon"'));
  assert.match(touch, /sizes="180x180"/);

  const url =
    "https://raw.githubusercontent.com/Buffer379x/scopearr/main/web/public/icon-256.png?v=2.0.0";
  assert.match(
    read("deploy/scopearr.xml"),
    new RegExp("<Icon>" + url.replace(/[.?]/g, "\\$&") + "</Icon>"),
  );
  assert.match(
    read("compose.yaml"),
    new RegExp(
      'net\\.unraid\\.docker\\.icon: "' + url.replace(/[.?]/g, "\\$&") + '"',
    ),
  );
});

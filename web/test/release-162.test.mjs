import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import * as mediaInfo from "../src/mediainfo.ts";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");

test("MediaInfo action requires both enabled and installed while saved evidence remains visible", () => {
  assert.equal(typeof mediaInfo.mediaInfoReadAvailable, "function");
  for (const [enabled, installed, want] of [
    [true, true, true],
    [true, false, false],
    [false, true, false],
    [false, false, false],
  ])
    assert.equal(
      mediaInfo.mediaInfoReadAvailable({ enabled, installed }),
      want,
    );
  assert.equal(mediaInfo.mediaInfoReadAvailable(undefined), false);
  assert.equal(mediaInfo.mediaInfoVisible(false, { scannedAt: 1 }), true);
});
test("File details owns the MediaInfo action after mux controls and only switches on success", () => {
  const code = src("components/FileDialog.tsx");
  assert.match(code, /useMediaInfoRead\(file,/);
  assert.match(code, /muxAvailable \|\| canReadMediaInfo/);
  assert.ok(
    code.indexOf('t("Remove mux marking")') <
      code.indexOf('"Read with MediaInfo"'),
  );
  assert.match(
    code,
    /writeSessionPreference\("scopearr-mediainfo-section", "result"\)/,
  );
  const hook = src("useMediaInfoRead.ts");
  assert.match(hook, /notify\(t\("MediaInfo values saved\."\), "success"\)/);
  assert.match(hook, /setError\(/);
  assert.match(hook, /notify\(message, "error"\)/);
});
test("MediaInfo tab contains display sections and adjacent read timestamp without a read button", () => {
  const code = src("components/MediaInfoPanel.tsx");
  assert.doesNotMatch(code, /<button|async function read|files\/mediainfo/);
  assert.match(code, /Last read: \{date\} · MediaInfo \{version\}/);
  assert.match(code, /Not read yet\. Use Read with MediaInfo above\./);
});
test("movie and episode details consistently use Film", () => {
  const files = [];
  const walk = (url) => {
    for (const entry of readdirSync(url, { withFileTypes: true })) {
      const path = new URL(entry.name + (entry.isDirectory() ? "/" : ""), url);
      if (entry.isDirectory()) walk(path);
      else if (/\.[jt]sx?$/.test(entry.name)) files.push(path);
    }
  };
  walk(new URL("../src/", import.meta.url));
  for (const path of files)
    assert.doesNotMatch(
      readFileSync(path, "utf8"),
      /FileVideo2/,
      path.pathname,
    );
  for (const path of [
    "components/RowInfo.tsx",
    "components/FileDialog.tsx",
    "components/ListLayoutSettings.tsx",
  ])
    assert.match(src(path), /<Film size=\{ICON\.(row|close|button)\}/);
});

// The API is the external boundary; the actual hook owns busy/error/result flow.
import ts from "typescript";
import { runInNewContext } from "node:vm";
function readHarness(request) {
  const state = [],
    notices = [],
    updates = [],
    calls = [];
  let cursor = 0;
  const exports = {};
  runInNewContext(
    ts.transpileModule(src("useMediaInfoRead.ts"), {
      compilerOptions: {
        target: ts.ScriptTarget.ES2022,
        module: ts.ModuleKind.CommonJS,
      },
    }).outputText,
    {
      exports,
      Error,
      require(path) {
        if (path === "preact/hooks")
          return {
            useState(initial) {
              const slot = cursor++;
              if (!(slot in state)) state[slot] = initial;
              return [state[slot], (value) => (state[slot] = value)];
            },
            useRef(initial) {
              const slot = cursor++;
              if (!(slot in state)) state[slot] = { current: initial };
              return state[slot];
            },
          };
        if (path === "./api")
          return {
            api: async (...args) => {
              calls.push(args);
              return request(...args);
            },
          };
        if (path === "./i18n") return { t: (key) => key };
        if (path === "./notifications")
          return { notify: (...args) => notices.push(args) };
        throw Error("Unexpected dependency " + path);
      },
    },
  );
  return {
    calls,
    notices,
    updates,
    render() {
      cursor = 0;
      return exports.useMediaInfoRead({ service: "sonarr-2", id: 42 }, (file) =>
        updates.push(file),
      );
    },
  };
}
test("MediaInfo hook waits for saved values, suppresses duplicate starts and reports success once", async () => {
  let resolve;
  const saved = { id: 42, service: "sonarr-2", mediaInfo: { scannedAt: 7 } };
  const harness = readHarness(() => new Promise((done) => (resolve = done)));
  const first = harness.render();
  const pending = first.read();
  assert.equal(harness.render().busy, true);
  await first.read();
  assert.equal(harness.calls.length, 1);
  assert.equal(harness.updates.length, 0);
  assert.deepEqual(JSON.parse(JSON.stringify(harness.calls[0])), [
    "files/mediainfo",
    "POST",
    { service: "sonarr-2", fileId: 42 },
    null,
    { notifyErrors: false },
  ]);
  resolve(saved);
  await pending;
  assert.equal(harness.render().busy, false);
  assert.equal(harness.render().error, "");
  assert.equal(harness.updates[0], saved);
  assert.deepEqual(harness.notices, [["MediaInfo values saved.", "success"]]);
});
test("failed MediaInfo reads retain the current file and expose one error notice and toast", async () => {
  const harness = readHarness(async () => {
    throw new Error("Synthetic read failure");
  });
  await harness.render().read();
  assert.equal(harness.render().busy, false);
  assert.equal(harness.render().error, "Synthetic read failure");
  assert.equal(harness.updates.length, 0);
  assert.deepEqual(harness.notices, [["Synthetic read failure", "error"]]);
});

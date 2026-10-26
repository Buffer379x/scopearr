import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { placementMessage } from "../src/placement-messages.ts";
const src = (path) =>
  readFileSync(new URL("../src/" + path, import.meta.url), "utf8");
test("File checks load and reset owner defaults from Unraid settings", () => {
  const code = src("components/FileCheckPage.tsx");
  assert.match(code, /ownerUid:\s*settings\?\.unraid\?\.ownerUid/);
  assert.match(code, /ownerGid:\s*settings\?\.unraid\?\.ownerGid/);
  const scan = src("components/FileCheckScanDialog.tsx");
  assert.match(scan, /const ownerUid =\s*settings\?\.unraid\?\.ownerUid/);
  assert.match(scan, /const ownerGid =\s*settings\?\.unraid\?\.ownerGid/);
  assert.match(scan, /edit\(\{ ownerUid, ownerGid \}\)/);
  const filters = code.slice(
    code.indexOf("<ActiveFilterBar"),
    code.indexOf("help={"),
  );
  assert.doesNotMatch(filters, /setOptions/);
});
test("Unraid paths and owner cards precede shares and show process identity", () => {
  const code = src("components/UnraidSettings.tsx");
  assert.match(code, /class="unraid-settings-grid"/);
  assert.match(code, /<CardHeading title=\{t\("Paths"\)\}/);
  assert.match(
    code,
    /<CardHeading[\s\S]*?title=\{t\("Files & permissions"\)\}/,
  );
  assert.ok(code.indexOf('t("Default owner")') < code.indexOf("<UnraidShares"));
  assert.match(code, /processUid/);
  assert.match(code, /processGid/);
  assert.match(
    src("styles/placement.css"),
    /\.unraid-settings-grid[\s\S]*grid-template-columns: repeat\(2, minmax\(0, 1fr\)\)/,
  );
});
test("Tag dialog queues selected new tags, prevents Enter submission and applies create", () => {
  const code = src("components/CustomBulk.tsx");
  assert.match(code, /new:\$\{/);
  assert.match(code, /maxLength=\{80\}/);
  assert.match(
    code,
    /onKeyDown=\{[\s\S]*?e\.key === "Enter"[\s\S]*?e\.preventDefault\(\)/,
  );
  assert.match(code, /create:/);
  assert.match(code, /t\("New"\)/);
  assert.match(code, /toLowerCase\(\)/);
  assert.match(code, /128/);
  assert.doesNotMatch(code, /Create custom tags in Settings first/);
});

test("manual owner explanation translates UID, GID and target independently", () => {
  let actual;
  const translated = placementMessage(
    "Scopearr runs as 99:100 and cannot assign 1000:101. Use the generated commands.",
    (key, params) => {
      actual = { key, params };
      return "translated owner reason";
    },
  );
  assert.equal(translated, "translated owner reason");
  assert.deepEqual(actual, {
    key: "Scopearr runs as {uid}:{gid} and cannot assign {owner}. Use the generated commands.",
    params: { uid: "99", gid: "100", owner: "1000:101" },
  });
});

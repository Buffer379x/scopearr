import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const src = p => readFileSync(new URL("../src/" + p, import.meta.url), "utf8");
test("log details retain copy/export without a job log action", () => {
  assert.doesNotMatch(src("components/EventLogViewer.tsx"), /Open job log|markLogSeen|MuxTerminalDialog/);
});

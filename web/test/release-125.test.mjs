import { readFileSync } from "node:fs";
import test from "node:test";
import assert from "node:assert/strict";
import { dashboardScope } from "../src/dashboard-widgets.ts";
import { settingsPayload } from "../src/settings-payload.ts";
import { muxLogClass, routineMuxMessages } from "../src/mux-spec.ts";
test("dashboard scope restores only supported browser preferences", () => {
  for (const value of ["all", "radarr", "sonarr"])
    assert.equal(dashboardScope(value), value);
  for (const value of [null, undefined, "", "emby", "Radarr"])
    assert.equal(dashboardScope(value), "all");
});
test("settings saves omit obsolete mux column controls from GET drafts", () => {
  const draft = {
    muxColumnOrder: ["invalid"],
    muxVisibleColumns: [],
    pageSize: 50,
    instances: [],
  };
  assert.deepEqual(settingsPayload(draft), { pageSize: 50, instances: [] });
  assert.deepEqual(draft.muxColumnOrder, ["invalid"]);
});
test("timestamped terminal messages retain error and success colors and rescan waits stay visible", () => {
  assert.equal(muxLogClass("12:34:56 Error: failed"), "terminal-error");
  assert.equal(muxLogClass("12:34:56 Done: Mux completed"), "terminal-success");
  for (const service of ["Radarr", "Sonarr"])
    for (const state of ["queued", "started"])
      assert.equal(
        routineMuxMessages.has(`Waiting for ${service} rescan (${state})`),
        false,
      );
});

test("mux recovery and rescan messages have translations in every catalog", () => {
  for (const locale of ["en", "de", "es", "it"]) {
    const catalog = JSON.parse(
      readFileSync(
        new URL(`../src/locales/${locale}.json`, import.meta.url),
        "utf8",
      ),
    );
    for (const key of [
      "Output check timed out",
      "Job state was lost. Start it again",
      "Job state was lost after replacement. Check the output and retry the rescan",
      ...["Radarr", "Sonarr"].flatMap((service) => [
        `Waiting for ${service} rescan (queued)`,
        `Waiting for ${service} rescan (started)`,
        `${service} did not finish the rescan within 5 minutes. The new file is in place.`,
      ]),
    ])
      assert.ok(catalog.messages[key], `${locale}: ${key}`);
  }
});

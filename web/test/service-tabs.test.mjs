import test from "node:test";
import assert from "node:assert/strict";
import { sortedServiceTabs } from "../src/instances.ts";
const instance = (id, name) => ({ id, name, enabled: true });
test("service tabs sort together without mutating saved order", () => {
  const items = [
    instance("sonarr", "Sonarr"),
    instance("radarr", "Radarr"),
    instance("jellyfin", "Jellyfin"),
    instance("emby", "Emby"),
  ];
  const before = structuredClone(items);
  assert.deepEqual(
    sortedServiceTabs(items, true, "en").map((x) => x.label),
    ["Emby", "Jellyfin", "MKVToolNix", "Radarr", "Sonarr"],
  );
  assert.deepEqual(items, before);
  assert.ok(!sortedServiceTabs(items, false, "de").some((x) => x.id === "mux"));
});
test("service labels use numeric, case insensitive ordering and ID tie breaks", () => {
  const items = [
    instance("r10", "Radarr 10"),
    instance("b", "emby"),
    instance("r2", "Radarr 2"),
    instance("a", "Emby"),
    { ...instance("disabled", "AAA"), enabled: false },
  ];
  assert.deepEqual(
    sortedServiceTabs(items, false, "en").map((x) => x.id),
    ["a", "b", "r2", "r10"],
  );
  items[0].name = "AAA";
  assert.equal(sortedServiceTabs(items, false, "en")[0].id, "r10");
});

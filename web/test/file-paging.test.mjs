import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The file dialog's paging model (Phase 5d, task 2): the position in the
// whole filtered list, the dialog route key and the arrow-key rule.

const paging = loadSource("file-paging.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("the file pager counts the whole filtered list", () => {
  const at = (page, position, count, extra = {}) =>
    plain(
      paging.filePager({
        page,
        pageSize: 100,
        total: 230,
        position,
        count,
        grouped: false,
        ...extra,
      }),
    );
  assert.deepEqual(at(1, 0, 100), {
    index: 1,
    total: 230,
    prev: null,
    next: { page: 1, position: 1 },
  });
  assert.deepEqual(at(1, 99, 100).next, { page: 2, position: 0 });
  assert.deepEqual(at(1, 99, 100).index, 100);
  assert.deepEqual(at(3, 29, 30), {
    index: 230,
    total: 230,
    prev: { page: 3, position: 28 },
    next: null,
  });
  assert.deepEqual(at(2, 0, 100).prev, { page: 1, position: "last" });
  assert.equal(at(2, 0, 100).index, 101);
  // Season pages (R-G): only inside the loaded page, no page change.
  assert.deepEqual(at(2, 0, 12, { grouped: true }), {
    index: 1,
    total: 12,
    prev: null,
    next: { page: 2, position: 1 },
  });
  assert.equal(at(2, 11, 12, { grouped: true }).next, null);
  // Edges: an empty list, a single file, and an exactly full last page.
  assert.deepEqual(at(1, 0, 0, { total: 0 }), {
    index: 1,
    total: 0,
    prev: null,
    next: null,
  });
  assert.deepEqual(at(1, 0, 1, { total: 1 }), {
    index: 1,
    total: 1,
    prev: null,
    next: null,
  });
  const full = at(2, 99, 100, { total: 200 });
  assert.deepEqual([full.index, full.next], [200, null]);
  assert.deepEqual(full.prev, { page: 2, position: 98 });
});

// A page of series (rc.4 R2) holds no fixed number of files: the answer's
// offset places the file, its page count decides the next page.
test("the file pager counts pages of series by their offset", () => {
  const at = (page, position, count, offset, pages) =>
    plain(
      paging.filePager({
        page,
        pageSize: 2,
        total: 122,
        position,
        count,
        grouped: false,
        series: { offset, pages },
      }),
    );
  assert.deepEqual(at(1, 0, 49, 0, 3), {
    index: 1,
    total: 122,
    prev: null,
    next: { page: 1, position: 1 },
  });
  assert.deepEqual(at(1, 48, 49, 0, 3).next, { page: 2, position: 0 });
  assert.deepEqual(at(2, 0, 48, 49, 3), {
    index: 50,
    total: 122,
    prev: { page: 1, position: "last" },
    next: { page: 2, position: 1 },
  });
  const last = at(3, 24, 25, 97, 3);
  assert.deepEqual([last.index, last.next], [122, null]);
});

test("file keys round-trip", () => {
  assert.equal(
    paging.fileKey({ service: "radarr-4k", id: 42 }),
    "radarr-4k:42",
  );
  assert.deepEqual(plain(paging.parseFileKey("radarr-4k:42")), {
    service: "radarr-4k",
    id: 42,
  });
  assert.equal(paging.parseFileKey("x"), null);
  assert.deepEqual(plain(paging.parseFileKey("sonarr:0")), {
    service: "sonarr",
    id: 0,
  });
  assert.equal(paging.parseFileKey("sonarr:-1"), null);
  assert.equal(paging.parseFileKey("sonarr:abc"), null);
  assert.equal(paging.parseFileKey("sonarr:1.5"), null);
  assert.equal(paging.parseFileKey(":3"), null);
  // Leading zeros would not round-trip to the same key.
  assert.equal(paging.parseFileKey("sonarr:007"), null);
  assert.equal(paging.parseFileKey("sonarr:00"), null);
});

test("paging keys ignore fields, menus, tab lists and modifiers", () => {
  const body = { tag: "div", role: null, editable: false, scroller: false };
  const key = (k, mods = {}, target = body) =>
    paging.pagingKey(
      {
        key: k,
        altKey: false,
        ctrlKey: false,
        metaKey: false,
        shiftKey: false,
        ...mods,
      },
      target,
    );
  assert.equal(key("ArrowUp"), "prev");
  assert.equal(key("ArrowDown"), "next");
  // A plain button or a div inside the dialog pages too.
  assert.equal(key("ArrowUp", {}, { ...body, tag: "button" }), "prev");
  assert.equal(key("ArrowDown", {}, { ...body, role: "dialog" }), "next");
  assert.equal(key("ArrowLeft"), null);
  assert.equal(key("Enter"), null);
  for (const tag of ["input", "textarea", "select"])
    assert.equal(key("ArrowDown", {}, { ...body, tag }), null);
  assert.equal(key("ArrowDown", {}, { ...body, editable: true }), null);
  assert.equal(key("ArrowDown", {}, { ...body, scroller: true }), null);
  for (const role of [
    "menu",
    "menuitem",
    "menuitemradio",
    "menuitemcheckbox",
    "tab",
    "listbox",
  ])
    assert.equal(key("ArrowUp", {}, { ...body, role }), null);
  for (const mod of ["altKey", "ctrlKey", "metaKey", "shiftKey"])
    assert.equal(key("ArrowUp", { [mod]: true }), null);
});

test("the dialog route opens, waits for or drops its key", () => {
  // Phase 5d T7 m2/m3: what the library does with the route's `file` key.
  const step = (over) =>
    paging.routeStep({
      wanted: "radarr:2",
      shown: "",
      mirrored: "",
      onPage: false,
      settled: true,
      fresh: false,
      checked: false,
      ...over,
    });
  // Nothing to do: no key, the dialog shows it, or the dialog wrote it
  // (a page step whose key the route does not carry yet, m2).
  assert.equal(step({ wanted: "" }), null);
  assert.equal(step({ shown: "radarr:2" }), null);
  assert.equal(step({ shown: "radarr:3", mirrored: "radarr:2" }), null);
  // The file is on the page: open it.
  assert.equal(step({ onPage: true }), "open");
  // The list is loading: wait for its answer.
  assert.equal(step({ settled: false }), null);
  // A new answer without the file drops the key.
  assert.equal(step({ fresh: true }), "drop");
  // The key came with no new answer: look once more after a render (a
  // request the key started shows as loading by then); still none: drop
  // (m3, a link with the same q).
  assert.equal(step({}), "check");
  assert.equal(step({ checked: true }), "drop");
});

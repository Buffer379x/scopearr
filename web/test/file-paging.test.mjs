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

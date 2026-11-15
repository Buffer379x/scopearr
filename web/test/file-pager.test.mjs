import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import { src } from "./helpers/sources.mjs";

// Paging File & metadata through the whole filtered list (Phase 5d, task
// 7, E16, R-G, user decision F2): useFilePager turns the paging model of
// file-paging.ts into the dialog's pager. A step on the page opens that
// file; a step past the page's end turns the list's page and, once its
// answer arrives, opens its first (or last) file. It is busy meanwhile.
// In the season view paging stays on the loaded page.

const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const file = (id) => ({ service: "radarr", id, filename: id + ".mkv" });
const results = (page, ids, total = 100, pageSize = 50) => ({
  files: ids.map(file),
  total,
  displayTotal: total,
  page,
  pageSize,
});
const range = (from, to) =>
  Array.from({ length: to - from + 1 }, (_, i) => from + i);

function pager(start) {
  const runtime = createHookRuntime();
  const { useFilePager } = loadSource("hooks/useFilePager.ts", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../file-paging": loadSource("file-paging.ts"),
    },
  });
  const h = {
    ...start,
    pages: [],
    opened: [],
    render() {
      runtime.flush();
      h.current = runtime.settle(() =>
        useFilePager({
          results: h.results,
          position: h.position,
          grouped: h.grouped,
          loading: !!h.loading,
          setPage: (page) => h.pages.push(page),
          // The library shows the opened file: its position on the page.
          open: (next) => {
            h.opened.push(next.id);
            h.position = h.results.files.indexOf(next);
          },
        }),
      );
      return h.current;
    },
  };
  h.render();
  return h;
}

test("the pager opens the next file and turns the page at its end", () => {
  // Without an open file on the page there is no pager.
  let h = pager({ results: results(1, range(1, 50)), position: null });
  assert.equal(h.current, undefined);

  // On the page: a step opens the neighbour at once.
  h = pager({ results: results(1, range(1, 50)), position: 10 });
  assert.deepEqual(
    [h.current.index, h.current.total, h.current.busy],
    [11, 100, false],
  );
  h.current.next();
  h.render();
  assert.equal(h.current.index, 12);
  h.current.prev();
  h.render();
  assert.deepEqual(h.opened, [12, 11]);
  assert.deepEqual(h.pages, []);

  // Position 99 of 100 (the last file of page 2 of 2, 50 per page) has no
  // next file.
  h = pager({ results: results(2, range(51, 100)), position: 49 });
  assert.deepEqual([h.current.index, h.current.total], [100, 100]);
  assert.equal(h.current.next, undefined);

  // The last file of page 1 turns to page 2; busy until its answer, which
  // opens its first file.
  h = pager({ results: results(1, range(1, 50)), position: 49 });
  h.current.next();
  h.render();
  assert.deepEqual(h.pages, [2]);
  assert.deepEqual(h.opened, []);
  assert.deepEqual([h.current.index, h.current.busy], [50, true]);
  // Steps wait meanwhile.
  assert.equal(h.current.next, undefined);
  assert.equal(h.current.prev, undefined);
  // A new answer of the old page changes nothing.
  h.results = results(1, range(1, 50));
  h.render();
  assert.deepEqual(h.opened, []);
  assert.equal(h.current.busy, true);
  h.results = results(2, range(51, 100));
  h.render();
  assert.deepEqual(h.opened, [51]);
  assert.deepEqual([h.current.index, h.current.busy], [51, false]);

  // The first of page 2 goes back to page 1 and opens its last file.
  h.current.prev();
  h.render();
  assert.deepEqual(h.pages, [2, 1]);
  h.results = results(1, range(1, 50));
  h.render();
  assert.deepEqual(h.opened, [51, 50]);
  assert.deepEqual([h.current.index, h.current.busy], [50, false]);
});

test("the season view pages only on the loaded page", () => {
  const h = pager({
    results: results(1, range(1, 50)),
    position: 49,
    grouped: true,
  });
  assert.deepEqual([h.current.index, h.current.total], [50, 50]);
  assert.equal(h.current.next, undefined);
  h.position = 0;
  h.results = results(2, range(51, 100));
  h.render();
  assert.equal(h.current.prev, undefined);
  h.current.next();
  h.render();
  assert.deepEqual(h.pages, []);
  assert.deepEqual(h.opened, [52]);
  assert.deepEqual([h.current.index, h.current.total], [2, 50]);
});

test("the pager stays out of the start set", () => {
  assert.match(src("hooks/useFilePager.ts"), /from "\.\.\/file-paging";/);
  assert.match(
    src("components/LibraryPage.tsx"),
    /from "\.\.\/hooks\/useFilePager";/,
  );
});

// Fix round (orchestrator ruling 3): when the neighbouring page's request
// ends without its answer (it failed; api() shows the error toast), the
// step is given up: the list goes back to the page it shows and the pager
// unlocks, on the file it showed.
test("a failed page turn unlocks the pager", () => {
  const h = pager({ results: results(1, range(1, 50)), position: 49 });
  h.current.next();
  h.render();
  assert.deepEqual([h.pages, h.current.busy], [[2], true]);
  // Not before the request has started.
  h.render();
  assert.equal(h.current.busy, true);
  h.loading = true;
  h.render();
  assert.equal(h.current.busy, true);
  h.loading = false;
  h.render();
  assert.deepEqual(h.pages, [2, 1]);
  assert.deepEqual(h.opened, []);
  assert.deepEqual(
    [h.current.index, h.current.busy, typeof h.current.next],
    [50, false, "function"],
  );
  // The next try turns the page again and opens its first file.
  h.current.next();
  h.render();
  h.loading = true;
  h.render();
  h.results = results(2, range(51, 100));
  h.loading = false;
  h.render();
  assert.deepEqual(h.opened, [51]);
  assert.deepEqual([h.current.index, h.current.busy], [51, false]);
});

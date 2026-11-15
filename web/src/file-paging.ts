// The file dialog's paging model (Phase 5d): where the open file stands in
// the whole filtered list, the key the dialog route carries, and the
// arrow-key rule. Pure, no imports; only the library page uses it, so it
// stays out of the start set.

// A step to another file: a page of the list and a position on it ("last"
// while the neighbouring page is not loaded yet).
export type FileStep = { page: number; position: number | "last" };

// `count` is the number of files on the loaded page; `grouped` is the
// season view (R-G), where paging stays inside the loaded page.
export function filePager(p: {
  page: number;
  pageSize: number;
  total: number;
  position: number;
  count: number;
  grouped: boolean;
}): {
  index: number;
  total: number;
  prev: FileStep | null;
  next: FileStep | null;
} {
  const prev: FileStep | null =
      p.position > 0
        ? { page: p.page, position: p.position - 1 }
        : !p.grouped && p.page > 1
          ? { page: p.page - 1, position: "last" }
          : null,
    next: FileStep | null =
      p.position < p.count - 1
        ? { page: p.page, position: p.position + 1 }
        : !p.grouped && p.page * p.pageSize < p.total
          ? { page: p.page + 1, position: 0 }
          : null;
  return p.grouped
    ? { index: p.position + 1, total: p.count, prev, next }
    : {
        index: (p.page - 1) * p.pageSize + p.position + 1,
        total: p.total,
        prev,
        next,
      };
}

// What the library does with the dialog route's `file` key (E17, R-H):
// `wanted` is the route's key, `shown` the open file's, `mirrored` the key
// the dialog last wrote; `onPage` the file is on the loaded page, `settled`
// the list is loaded and not loading, `fresh` an answer arrived since the
// key came, `checked` the key was looked at once more. A key the dialog
// wrote itself is never reopened (a page step races its mirror). A key
// whose file is not there goes once a new answer lacks it, or when no
// request follows it (a render later the list is still settled).
export function routeStep(p: {
  wanted: string;
  shown: string;
  mirrored: string;
  onPage: boolean;
  settled: boolean;
  fresh: boolean;
  checked: boolean;
}): "open" | "check" | "drop" | null {
  if (!p.wanted || p.wanted === p.shown || p.wanted === p.mirrored) return null;
  if (p.onPage) return "open";
  if (!p.settled) return null;
  return p.fresh || p.checked ? "drop" : "check";
}

// The dialog route's key: "<service>:<id>".
export function fileKey(file: { service: string; id: number }): string {
  return file.service + ":" + file.id;
}
export function parseFileKey(
  value: string,
): { service: string; id: number } | null {
  const at = value.lastIndexOf(":");
  if (at < 1) return null;
  const digits = value.slice(at + 1);
  // No leading zeros: the key must round-trip.
  if (!/^(0|[1-9]\d*)$/.test(digits)) return null;
  const id = Number(digits);
  return Number.isSafeInteger(id) ? { service: value.slice(0, at), id } : null;
}

// ArrowUp / ArrowDown page through the files, except where they belong to
// the focused control: a field, a menu, a tab list, a scrollable region, or
// with a modifier key.
const OWN_ARROWS =
  /^(?:menu|menuitem|menuitemradio|menuitemcheckbox|tab|listbox)$/;
export function pagingKey(
  e: {
    key: string;
    altKey: boolean;
    ctrlKey: boolean;
    metaKey: boolean;
    shiftKey: boolean;
  },
  target: {
    tag: string;
    role: string | null;
    editable: boolean;
    scroller: boolean;
  },
): "prev" | "next" | null {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return null;
  if (e.key !== "ArrowUp" && e.key !== "ArrowDown") return null;
  if (
    target.editable ||
    target.scroller ||
    /^(?:input|textarea|select)$/i.test(target.tag) ||
    (target.role !== null && OWN_ARROWS.test(target.role))
  )
    return null;
  return e.key === "ArrowUp" ? "prev" : "next";
}

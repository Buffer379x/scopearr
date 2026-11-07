import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { readSources, src } from "./helpers/sources.mjs";

const eventLog = loadSource("event-log.ts");
const storage = loadSource("browser-storage.ts");
const toolRoute = loadSource("tool-route.ts", {
  modules: { "./browser-storage": storage },
});
const {
  DEFAULT_ROUTE,
  MOVIE_SORT_FIELDS,
  SETTINGS_SECTIONS,
  formatRoute,
  parseRoute,
} = loadSource("router.ts", {
  modules: { "./event-log": eventLog, "./tool-route": toolRoute },
});
const { toolRouteQuery, toolRouteState } = toolRoute;
const { eventQuery, logQuery, parseLogQuery } = eventLog;

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const route = (hash) => plain(parseRoute(hash));
const canonical = (hash) => formatRoute(parseRoute(hash));
const dashboard = { view: "statistics" };
const library = (service, filters = "", page = 1, sort = null) => ({
  view: "library",
  service,
  filters,
  page,
  sort,
});
const settings = (section, tab = "", query = "") => ({
  view: "settings",
  section,
  tab,
  query,
});
const tool = (view, query = "") => ({ view, query });
const emptyFilters = { statuses: [], targets: [], kinds: [], q: "" };

test("the default route cannot be mutated through a returned fallback", () => {
  assert.throws(() => {
    parseRoute("").view = "library";
  }, TypeError);
  assert.deepEqual(plain(parseRoute("#/nope")), dashboard);
  assert.deepEqual(plain(DEFAULT_ROUTE), dashboard);
});

test("routes parse every page of the schema", () => {
  assert.deepEqual(plain(DEFAULT_ROUTE), dashboard);
  assert.deepEqual(plain(SETTINGS_SECTIONS), [
    "connections",
    "appearance",
    "widgets",
    "custom",
    "recognition",
    "system",
  ]);
  const cases = [
    ["#/dashboard", dashboard],
    [
      "#/movies?instance=radarr-4k&q=Tenet",
      library("radarr", "instance=radarr-4k&q=Tenet"),
    ],
    [
      "#/series?resolution=2160p&page=2&sort=size&dir=desc",
      library("sonarr", "resolution=2160p", 2, {
        field: "size",
        direction: "desc",
      }),
    ],
    [
      "#/tools/mux?q=Heat&status=ready&status=failed&sort=size&dir=asc&page=2",
      tool("mux", "q=Heat&status=ready&status=failed&sort=size&dir=asc&page=2"),
    ],
    [
      "#/tools/placement?q=Heat&status=split&target=disk2&kind=small_files&sort=size&dir=desc&page=3",
      tool(
        "disks",
        "q=Heat&status=split&target=disk2&kind=small_files&sort=size&dir=desc&page=3",
      ),
    ],
    [
      "#/tools/files?q=Heat&status=open&kind=owner&kind=hidden&sort=path&dir=asc&page=4",
      tool(
        "files",
        "q=Heat&status=open&kind=owner&kind=hidden&sort=path&dir=asc&page=4",
      ),
    ],
    ["#/settings/connections", settings("connections")],
    ["#/settings/connections/radarr-4k", settings("connections", "radarr-4k")],
    ["#/settings/connections/mux", settings("connections", "mux")],
    ["#/settings/connections/unraid", settings("connections", "unraid")],
    ["#/settings/connections/mediainfo", settings("connections", "mediainfo")],
    ["#/settings/appearance", settings("appearance")],
    ["#/settings/appearance/general", settings("appearance", "general")],
    ["#/settings/appearance/lists", settings("appearance", "lists")],
    ["#/settings/appearance/colors", settings("appearance", "colors")],
    ["#/settings/widgets", settings("widgets")],
    ["#/settings/custom", settings("custom")],
    ["#/settings/recognition", settings("recognition")],
    ["#/settings/system", settings("system")],
    ["#/settings/system/info", settings("system", "info")],
    ["#/settings/system/log", settings("system", "log")],
    [
      "#/settings/system/log?q=sync+failed&level=error&level=warning&source=sync&instance=radarr-4k",
      settings(
        "system",
        "log",
        "q=sync+failed&level=error&level=warning&source=sync&instance=radarr-4k",
      ),
    ],
  ];
  for (const [hash, expected] of cases)
    assert.deepEqual(route(hash), expected, hash);
  // location.hash may be read without its "#".
  assert.deepEqual(route("/tools/files"), tool("files"));
});

test("formatting is canonical and round-trips", () => {
  const routes = [
    dashboard,
    library("radarr"),
    library("sonarr"),
    library("radarr", "instance=radarr-4k&q=Tenet+2020", 3, {
      field: "size",
      direction: "desc",
    }),
    library("sonarr", "custom=12&customOp=and", 1, {
      field: "title",
      direction: "desc",
    }),
    tool("mux"),
    tool("mux", "q=Heat&status=failed&sort=filename&dir=desc&page=2"),
    tool("disks", "status=split&target=disk1&kind=media_files"),
    tool("files", "q=a+b&kind=owner&page=5"),
    ...SETTINGS_SECTIONS.map((section) => settings(section)),
    settings("connections", "sonarr-anime"),
    settings("appearance", "colors"),
    settings("system", "info"),
    settings("system", "log", "q=x&source=sync&instance=radarr-4k"),
  ];
  for (const value of routes) {
    const hash = formatRoute(value);
    assert.ok(hash.startsWith("#/"), hash);
    assert.deepEqual(route(hash), value, hash);
    assert.equal(canonical(hash), hash, hash);
  }
  const hashes = [
    "#/dashboard",
    "#/movies",
    "#/series?q=The+Office&page=2",
    "#/movies?instance=radarr-4k&resolution=2160p&resolutionOp=not&page=4&sort=hdr&dir=asc",
    "#/tools/mux?q=Heat&status=queued&sort=status&dir=asc&page=2",
    "#/tools/placement?q=x&status=ok&target=disk3&kind=small_files&sort=disks&dir=desc&page=9",
    "#/tools/files?status=failed&kind=junk",
    "#/settings/connections/radarr-4k",
    "#/settings/appearance/lists",
    "#/settings/system/log?q=a+b&level=error",
  ];
  for (const hash of hashes) assert.equal(canonical(hash), hash, hash);
  const normalized = [
    // The first page and the default sort are implied.
    ["#/movies?q=a&page=1", "#/movies?q=a"],
    ["#/movies?sort=title&dir=asc", "#/movies"],
    [
      "#/movies?page=02&sort=title&dir=desc",
      "#/movies?page=2&sort=title&dir=desc",
    ],
    ["#/tools/mux?page=1&q=", "#/tools/mux"],
    // Spaces always come out as "+".
    ["#/movies?q=a%20b", "#/movies?q=a+b"],
    ["#/tools/files?q=a%20b", "#/tools/files?q=a+b"],
    ["#/settings/system/log?q=a%20b", "#/settings/system/log?q=a+b"],
    // Tool keys follow the schema order.
    [
      "#/tools/placement?page=2&dir=desc&sort=size&kind=media_files&target=disk1&status=split&q=x",
      "#/tools/placement?q=x&status=split&target=disk1&kind=media_files&sort=size&dir=desc&page=2",
    ],
    ["#/tools/mux?dir=asc&status=ready&q=x", "#/tools/mux?q=x&status=ready"],
    [
      "#/settings/system/log?instance=b&source=a&level=info&q=x",
      "#/settings/system/log?q=x&level=info&source=a&instance=b",
    ],
    ["#/settings", "#/settings/connections"],
    ["/movies", "#/movies"],
  ];
  for (const [hash, expected] of normalized) {
    assert.equal(canonical(hash), expected, hash);
    assert.equal(canonical(expected), expected, expected);
  }
  // Route objects that are not canonical still format to the one form.
  assert.equal(
    formatRoute(
      library("radarr", "q=a&page=4&sort=size&dir=desc&service=sonarr", 1, {
        field: "title",
        direction: "asc",
      }),
    ),
    "#/movies?q=a",
  );
  assert.equal(
    formatRoute(tool("mux", "page=1&kind=owner&target=disk1&q=x")),
    "#/tools/mux?q=x",
  );
  assert.equal(
    formatRoute(settings("appearance", "bogus", "q=x")),
    "#/settings/appearance",
  );
  assert.equal(
    formatRoute(settings("system", "info", "q=x")),
    "#/settings/system/info",
  );
});

// Deterministic generator (mulberry32) for the broken-hash sweep.
function random(seed) {
  return () => {
    seed = (seed + 0x6d2b79f5) | 0;
    let value = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

test("unknown or broken hashes fall back to the dashboard", () => {
  for (const hash of [
    "",
    "#",
    "#/",
    "/",
    "#dashboard",
    "#?q=x",
    "#/nope",
    "#/Movies",
    "#//movies",
    "#/movies/",
    "#/movies/extra",
    "#/dashboard/extra",
    "#/tools",
    "#/tools/nope",
    "#/tools/disks",
    "#/tools/mux/extra",
    "#/settings/system/log/extra",
    "#/settings/connections/radarr/extra",
    "#/movies%",
    "#/%E0%A4%A",
    "#/settings/%zz",
    "#/settings/connections/%E0%A4",
    "#/settings/connections/\uD800",
  ])
    assert.deepEqual(route(hash), dashboard, JSON.stringify(hash));
  // Settings fall back inside settings.
  for (const [hash, expected] of [
    ["#/settings", settings("connections")],
    ["#/settings/", settings("connections")],
    ["#/settings/nope", settings("connections")],
    ["#/settings/nope/log?level=error", settings("connections")],
    ["#/settings/connections/", settings("connections")],
    ["#/settings/connections?level=error", settings("connections")],
    ["#/settings/appearance/bogus", settings("appearance")],
    ["#/settings/appearance/log", settings("appearance")],
    ["#/settings/widgets/general", settings("widgets")],
    ["#/settings/custom/x", settings("custom")],
    ["#/settings/recognition/x", settings("recognition")],
    ["#/settings/system/nope?level=error", settings("system")],
    ["#/settings/system?level=error", settings("system")],
  ])
    assert.deepEqual(route(hash), expected, hash);
  // Library pages are whole numbers from 1; a sort needs a valid direction.
  for (const page of [
    "0",
    "-2",
    "1.5",
    "abc",
    "",
    "1e3",
    "99999999999999999999",
  ])
    assert.equal(route("#/movies?page=" + page).page, 1, page);
  for (const query of [
    "sort=size",
    "dir=desc",
    "sort=size&dir=up",
    "sort=&dir=asc",
    "sort=bogus&dir=asc",
    "sort=language&dir=asc",
  ])
    assert.equal(route("#/movies?" + query).sort, null, query);

  const next = random(20251106);
  const pick = (list) => list[Math.floor(next() * list.length)];
  const prefixes = [
    "",
    "#",
    "#/",
    "#/dashboard",
    "#/movies",
    "#/series",
    "#/tools/mux",
    "#/tools/placement",
    "#/tools/files",
    "#/settings",
    "#/settings/connections",
    "#/settings/system/log",
  ];
  const pieces = [
    ...["/", "?", "&", "=", "#", "%", "%2", "%2F", "%20", "%E0%A4", "%zz"],
    ...["+", " ", "é", "😀", "\uD800", "1", "2", "-3", "02"],
    ...["q", "page", "sort", "dir", "service", "status", "target", "kind"],
    ...["level", "source", "instance", "asc", "desc", "title", "size"],
    ...["movies", "tools", "mux", "settings", "system", "log", "lists"],
  ];
  const views = new Set();
  for (let i = 0; i < 500; i++) {
    let hash = pick(prefixes);
    for (let n = Math.floor(next() * 9); n > 0; n--) hash += pick(pieces);
    let parsed, first;
    assert.doesNotThrow(() => {
      parsed = parseRoute(hash);
      first = formatRoute(parsed);
    }, JSON.stringify(hash));
    views.add(parsed.view);
    assert.ok(first.startsWith("#/"), JSON.stringify(hash));
    assert.equal(canonical(first), first, JSON.stringify(hash));
    assert.deepEqual(route(first), plain(parsed), JSON.stringify(hash));
  }
  // The sweep reaches every view, not only the fallback.
  assert.deepEqual([...views].sort(), [
    "disks",
    "files",
    "library",
    "mux",
    "settings",
    "statistics",
  ]);
});

test("special characters survive the round trip", () => {
  const texts = ["Amélie & Co #1/2 100%+?=", "C++", "Film 🎬 ünïcødé"];
  const extra = (hash) => {
    // One "#" opens the fragment; no raw space or second "#" may follow.
    assert.ok(!hash.slice(1).includes("#"), hash);
    assert.ok(!/\s/.test(hash), hash);
  };
  for (const q of texts) {
    const filters = new URLSearchParams([
      ["instance", "radarr-4k"],
      ["q", q],
    ]).toString();
    const movies = formatRoute(library("radarr", filters, 2));
    extra(movies);
    assert.deepEqual(route(movies), library("radarr", filters, 2));
    assert.equal(new URLSearchParams(route(movies).filters).get("q"), q);
    assert.equal(
      new URLSearchParams(route(movies).filters).get("instance"),
      "radarr-4k",
    );

    const query = toolRouteQuery("mux", {
      filters: { ...emptyFilters, q },
      sort: null,
      page: 1,
    });
    const mux = formatRoute(tool("mux", query));
    extra(mux);
    const allowed = { statuses: [], sorts: [] };
    assert.equal(toolRouteState(route(mux).query, allowed).filters.q, q);
    // Browsers may hand back other escapes; the value is the same.
    const typed = "#/tools/mux?q=" + encodeURIComponent(q);
    assert.equal(toolRouteState(route(typed).query, allowed).filters.q, q);
    assert.equal(canonical(typed), mux);

    const filter = { q, source: ["sync"], instance: ["radarr-4k"] };
    const log = formatRoute(settings("system", "log", logQuery(filter)));
    extra(log);
    assert.deepEqual(plain(parseLogQuery(route(log).query)), filter);
  }
  // Path segments are escaped, so a "/" stays inside the service tab.
  const tab = formatRoute(settings("connections", "emby 2/x"));
  assert.equal(tab, "#/settings/connections/emby%202%2Fx");
  assert.deepEqual(route(tab), settings("connections", "emby 2/x"));
  for (const id of ["radarr-4k", "Jellyfin #2 & Co", "Kino 😀", "100%"]) {
    const hash = formatRoute(settings("connections", id));
    extra(hash);
    assert.deepEqual(route(hash), settings("connections", id), id);
  }
});

test("library reserves page, sort and dir and keeps filter order", () => {
  const hash =
    "#/movies?resolution=2160p&page=3&custom=12&sort=size&custom=7&dir=desc" +
    "&customOp=and&service=sonarr&codecOp=not&codec=hevc";
  assert.deepEqual(
    route(hash),
    library(
      "radarr",
      "resolution=2160p&custom=12&custom=7&customOp=and&codecOp=not&codec=hevc",
      3,
      { field: "size", direction: "desc" },
    ),
  );
  assert.equal(
    canonical(hash),
    "#/movies?resolution=2160p&custom=12&custom=7&customOp=and&codecOp=not" +
      "&codec=hevc&page=3&sort=size&dir=desc",
  );
  assert.deepEqual(plain(MOVIE_SORT_FIELDS), [
    "info",
    "title",
    "year",
    "resolution",
    "codec",
    "source",
    "processing",
    "size",
    "hdr",
    "bitDepth",
    "audio",
    "channels",
    "custom",
  ]);
  for (const field of MOVIE_SORT_FIELDS)
    for (const direction of ["asc", "desc"]) {
      const value = library("sonarr", "q=x", 1, { field, direction });
      const formatted = formatRoute(value);
      if (field === "title" && direction === "asc")
        assert.equal(formatted, "#/series?q=x");
      else {
        assert.equal(formatted, `#/series?q=x&sort=${field}&dir=${direction}`);
        assert.deepEqual(route(formatted), value);
      }
    }
  // The default sort reads as no sort, so parsing is stable through its
  // canonical form.
  for (const hash of [
    "#/movies?sort=title&dir=asc",
    "#/series?q=x&sort=title&dir=asc&page=2",
  ]) {
    assert.equal(route(hash).sort, null, hash);
    assert.deepEqual(route(formatRoute(parseRoute(hash))), route(hash), hash);
  }
  // The library keeps one list of sortable fields.
  const state = src("hooks/useAppNavigation.ts");
  assert.match(
    state,
    /import \{[^}]*\bMOVIE_SORT_FIELDS\b[^}]*\} from "\.\.\/router";/,
  );
  assert.match(state, /MOVIE_SORT_FIELDS\.includes\(saved\.field\)/);
  assert.doesNotMatch(
    readSources(["hooks/useAppNavigation.ts", "hooks/useLibraryState.ts"]),
    /movieSortFields/,
  );
});

test("tool queries keep only their own keys", () => {
  const raw =
    "share=movies&page=2&kind=small_files&target=disk1&status=split&q=x" +
    "&sort=size&dir=asc&level=error&instance=radarr&service=radarr";
  const expected = {
    mux: "q=x&status=split&sort=size&dir=asc&page=2",
    disks:
      "q=x&status=split&target=disk1&kind=small_files&sort=size&dir=asc&page=2",
    files: "q=x&status=split&kind=small_files&sort=size&dir=asc&page=2",
  };
  const paths = { mux: "mux", disks: "placement", files: "files" };
  const state = {
    filters: {
      q: "x",
      statuses: ["split"],
      targets: ["disk1"],
      kinds: ["small_files"],
    },
    sort: { field: "size", direction: "asc" },
    page: 2,
  };
  for (const view of ["mux", "disks", "files"]) {
    assert.deepEqual(
      route(`#/tools/${paths[view]}?${raw}`),
      tool(view, expected[view]),
    );
    assert.equal(toolRouteQuery(view, state), expected[view], view);
    assert.equal(
      toolRouteQuery(view, { filters: emptyFilters, sort: null, page: 1 }),
      "",
    );
    assert.equal(formatRoute(tool(view, "")), `#/tools/${paths[view]}`, view);
  }
  // One search value; empty values drop out.
  assert.deepEqual(
    route("#/tools/files?q=a&q=b&status=&kind=&kind=owner"),
    tool("files", "q=a&kind=owner"),
  );
  assert.deepEqual(route("#/tools/mux?q="), tool("mux"));
  assert.deepEqual(route("#/tools/mux?sort=size"), tool("mux"));
  assert.deepEqual(route("#/tools/mux?page=0"), tool("mux"));
});

test("a blank search is no filter", () => {
  // An empty or blank q drops out; the other filters keep their order.
  assert.deepEqual(route("#/movies?q=+"), library("radarr"));
  assert.deepEqual(route("#/movies?q="), library("radarr"));
  assert.deepEqual(
    route("#/series?resolution=1080p&q=%20%20&codec=hevc&page=2"),
    library("sonarr", "resolution=1080p&codec=hevc", 2),
  );
  assert.deepEqual(route("#/tools/mux?q=%20"), tool("mux"));
  assert.deepEqual(
    route("#/tools/placement?q=+&status=split"),
    tool("disks", "status=split"),
  );
  // The round trip is canonical.
  for (const [hash, expected] of [
    ["#/movies?q=+", "#/movies"],
    ["#/movies?q=%20&resolution=1080p", "#/movies?resolution=1080p"],
    ["#/tools/mux?q=%20", "#/tools/mux"],
    ["#/tools/files?q=++&kind=owner", "#/tools/files?kind=owner"],
  ]) {
    assert.equal(canonical(hash), expected, hash);
    assert.equal(canonical(expected), expected, expected);
  }
  // Route objects with a blank search format without it.
  assert.equal(
    formatRoute(library("radarr", "q=+&codec=hevc")),
    "#/movies?codec=hevc",
  );
  assert.equal(formatRoute(tool("files", "q=%20%20")), "#/tools/files");
  assert.equal(
    toolRouteQuery("mux", {
      filters: { ...emptyFilters, q: "   " },
      sort: null,
      page: 1,
    }),
    "",
  );
  // A tool page reads no filter from it either.
  assert.deepEqual(
    plain(toolRouteState("q=+", { statuses: [], sorts: [] })),
    {},
  );
  // A search with text keeps its spaces.
  assert.equal(canonical("#/movies?q=+a+"), "#/movies?q=+a+");
  assert.equal(canonical("#/tools/mux?q=+a+"), "#/tools/mux?q=+a+");
});

test("tool route state prefers the URL and leaves gaps to storage", () => {
  const allowed = {
    statuses: ["open", "failed"],
    kinds: ["owner", "hidden"],
    sorts: ["path", "size"],
  };
  const state = (query) => toolRouteState(query, allowed);
  assert.deepEqual(Object.keys(state("")), []);
  // Only the parts the URL names are set; the rest stays undefined.
  const sorted = state("sort=size&dir=desc");
  assert.deepEqual(Object.keys(sorted), ["sort"]);
  assert.deepEqual(plain(sorted.sort), { field: "size", direction: "desc" });
  assert.equal(sorted.filters, undefined);
  assert.equal(sorted.page, undefined);
  const paged = state("page=4");
  assert.deepEqual(Object.keys(paged), ["page"]);
  assert.equal(paged.page, 4);
  // URL filters without a page start on page 1.
  const filtered = state(
    "q=x&status=open&status=bogus&kind=owner&kind=nope&target=disk1",
  );
  assert.deepEqual(Object.keys(filtered).sort(), ["filters", "page"]);
  assert.deepEqual(plain(filtered.filters), {
    statuses: ["open"],
    targets: ["disk1"],
    kinds: ["owner"],
    q: "x",
  });
  assert.equal(filtered.page, 1);
  // The same rules as stored filters.
  assert.deepEqual(
    plain(filtered.filters),
    plain(
      storage.parseToolFilters(
        JSON.stringify({
          q: "x",
          statuses: ["open", "bogus"],
          targets: ["disk1"],
          kinds: ["owner", "nope"],
        }),
        allowed,
      ),
    ),
  );
  const rejected = state("status=bogus");
  assert.deepEqual(plain(rejected), { filters: emptyFilters, page: 1 });
  assert.equal(state("q=x&page=3").page, 3);
  assert.equal(state("q=x&page=abc").page, 1);
  assert.deepEqual(Object.keys(state("page=abc")), []);
  assert.deepEqual(Object.keys(state("page=0")), []);
  // Disallowed fields and directions leave the stored sort.
  for (const query of [
    "sort=bogus&dir=asc",
    "sort=size&dir=sideways",
    "sort=size",
    "dir=asc",
  ])
    assert.deepEqual(Object.keys(state(query)), [], query);
  // What a page writes it reads back.
  const full = {
    filters: {
      q: "Heat",
      statuses: ["failed"],
      targets: [],
      kinds: ["hidden"],
    },
    sort: { field: "path", direction: "desc" },
    page: 3,
  };
  assert.deepEqual(plain(state(toolRouteQuery("files", full))), full);
  assert.deepEqual(
    plain(state(toolRouteQuery("files", { ...full, sort: null, page: 1 }))),
    { filters: full.filters, page: 1 },
  );
});

test("log queries use the event-log names", () => {
  const filter = {
    q: "sync failed",
    level: ["error", "warning"],
    source: ["sync"],
    instance: ["radarr-4k"],
  };
  const query = logQuery(filter);
  assert.equal(
    query,
    "q=sync+failed&level=error&level=warning&source=sync&instance=radarr-4k",
  );
  assert.equal(
    eventQuery(filter, null),
    query + "&sort=ts&dir=desc&limit=25&offset=0",
  );
  assert.deepEqual(plain(parseLogQuery(query)), filter);
  assert.equal(
    logQuery({ instance: ["b"], source: ["a"], level: ["info"], q: "x" }),
    "q=x&level=info&source=a&instance=b",
  );
  assert.equal(logQuery({ q: "  ", level: [], source: [""] }), "");
  assert.equal(logQuery({}), "");
  assert.deepEqual(plain(parseLogQuery("")), {});
  assert.deepEqual(
    plain(parseLogQuery("q=+x+&level=error&sort=ts&page=2&source=&bogus=1")),
    { q: "x", level: ["error"] },
  );
  assert.deepEqual(
    route("#/settings/system/log?level=error&sort=ts&page=3"),
    settings("system", "log", "level=error"),
  );
  assert.deepEqual(
    route("#/settings/system/info?level=error"),
    settings("system", "info"),
  );
  assert.equal(
    formatRoute(settings("system", "log", query)),
    "#/settings/system/log?" + query,
  );
});

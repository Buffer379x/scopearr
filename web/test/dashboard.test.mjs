import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import {
  PRESENTATION_MODULES,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import * as filter from "../src/dashboard-filter.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagLabels from "../src/tag-labels.ts";

// The dashboard on the C+ cards (Phase 5a, task 10; docs/STYLEGUIDE.md,
// Part 1, 10.2, 10.10 and 11.3): StatisticsPage with its KPI row, widget
// row and distribution grid, and the cards of components/dashboard/. Each
// runs as real code with the hook runtime; the cards are named stubs in
// the page's tree, so a tree shows what they receive.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "{" + name + "}");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };
const plain = (value) => JSON.parse(JSON.stringify(value ?? null));
const classes = (node) => (node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
const NBSP = "\u00a0";

const ui = {
  ICON: { chip: 12, button: 16, large: 18, empty: 28 },
  count: (n) => new Intl.NumberFormat("en").format(n),
  percent: (n) =>
    new Intl.NumberFormat("en", { maximumFractionDigits: 1 }).format(n) +
    "\u202f%",
  labels: {
    resolution: "Resolution",
    codec: "Codec / encoder",
    source: "Source",
    audio: "Audio codec",
    language: "Language",
  },
  TagLabels: { name: "TagLabels" },
};
const widgets = loadSource("dashboard-widgets.ts");
const model = loadSource("dashboard-model.ts", {
  modules: { "./i18n": i18n, "./dashboard-widgets": widgets },
});
const matching = loadSource("media-matching.ts");

const statistics = {
  movies: 26,
  series: 5,
  episodes: 123,
  files: 148,
  incomplete: 4,
  emby: { matched: 2, no_tracks: 1, missing: 3, pending: 140, ambiguous: 2 },
  fileTotals: { all: 148, radarr: 26, sonarr: 122 },
  languageTotals: { all: 151, radarr: 27, sonarr: 124 },
  distributions: {
    all: {
      resolution: [
        { value: "1080p", count: 94 },
        { value: "480p", count: 3 },
        { value: "576p", count: 2 },
        { value: "", count: 1 },
      ],
      codec: [{ value: "x264", count: 148 }],
      source: [],
      audio: [{ value: "DTS", count: 120 }],
      language: [{ value: "English", count: 144 }],
    },
    radarr: { resolution: [{ value: "2160p", count: 26 }] },
    sonarr: { resolution: [{ value: "1080p", count: 122 }] },
  },
};
const settingsWith = (order, visible, extra = {}) => ({
  groupSD: true,
  widgets: {
    order,
    visible,
    storage: {},
    colors: { used: "#ff0000", free: "#00ff00" },
  },
  ...extra,
});
const ALL = ["resolution", "codec", "source", "audio", "language", "storage"];

// --- StatisticsPage -----------------------------------------------------

function dashboard({
  settings = settingsWith(ALL, ALL),
  service = "radarr",
  stored = {},
} = {}) {
  const runtime = createHookRuntime();
  const calls = { api: [], links: [], filters: [], writes: [], focus: [] };
  // The page's document: focus on body until a test moves it; main is the
  // shell's #main (tabindex -1).
  const document = {
    body: { name: "body" },
    activeElement: null,
    getElementById: (id) =>
      id === "main"
        ? { focus: (options) => calls.focus.push(["main", plain(options)]) }
        : null,
  };
  document.activeElement = document.body;
  const requests = [];
  const page = loadSource("components/StatisticsPage.tsx", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../api": {
        api(path, method, body, signal) {
          calls.api.push([path, method ?? "GET"]);
          return new Promise((resolve, reject) =>
            requests.push({ resolve, reject, signal }),
          );
        },
      },
      "../browser-storage": {
        readPreference: (key) => stored[key] ?? null,
        writePreference: (key, value) => calls.writes.push([key, value]),
      },
      "../i18n": i18n,
      "../ui": ui,
      "../dashboard-widgets": widgets,
      "../dashboard-model": model,
      "../dashboard-filter": filter,
      "../resolution-groups": resolution,
      "./list/Segmented": { Segmented: "Segmented" },
      "./dashboard/IncompleteCard": { IncompleteCard: "IncompleteCard" },
      "./dashboard/MatchingCard": { MatchingCard: "MatchingCard" },
      "./dashboard/StorageCard": { StorageCard: "StorageCard" },
      "./dashboard/DistributionCard": {
        DistributionCard: "DistributionCard",
      },
    },
    browser: { AbortController, document },
    stubs: PRESENTATION_MODULES,
  });
  const status = { sync: {}, recognitionRevision: 1, cacheRevision: 1 };
  const props = {
    status,
    settings,
    service,
    hrefOf: (target) =>
      "#/" +
      (target.view === "library"
        ? (target.service === "sonarr" ? "series" : "movies") +
          (target.query ? "?" + target.query : "")
        : target.view),
    open: (target) => calls.links.push(plain(target)),
    onFilter: (...args) => calls.filters.push(args),
  };
  const render = () =>
    runtime.settle(() => page.StatisticsPage({ ...props, status }));
  return {
    runtime,
    calls,
    requests,
    props,
    document,
    render,
    async answer(value = statistics) {
      requests.at(-1).resolve(value);
      await new Promise((resolve) => setTimeout(resolve));
      return render();
    },
    async fail(message = "Scopearr is not reachable") {
      requests.at(-1).reject(new Error(message));
      await new Promise((resolve) => setTimeout(resolve));
      return render();
    },
  };
}

const tabsOf = (tree) => ofType(tree, "Segmented")[0];

// The shape of a page: every card by type with the class of its host, in
// order, and the props that set a card's height (never its data).
const cardShape = (tree) =>
  nodes(tree)
    .filter((n) =>
      [
        "KpiCard",
        "IncompleteCard",
        "MatchingCard",
        "StorageCard",
        "DistributionCard",
      ].includes(n.type),
    )
    .map((n) => n.type + (n.props.field ? ":" + n.props.field : ""));
const hosts = (tree) =>
  ["v2-dash", "v2-dash-kpis", "v2-dash-row", "v2-dash-head", "v2-dash-grid"]
    .map((name) => [name, byClass(tree, name).length])
    .filter(([, n]) => n);

test("dashboard cards render their final size without data", async () => {
  const page = dashboard();
  const loading = page.render();
  assert.deepEqual(page.calls.api, [["statistics", "GET"]]);
  // Only screen readers hear the loading state, in a status region.
  const [status] = ofType(loading, "p").filter((n) =>
    classes(n).includes("v2-sr-only"),
  );
  assert.equal(status.props.role, "status");
  assert.equal(text(status), "Loading dashboard …");
  // The same cards, in the same hosts, before and after the data.
  const before = cardShape(loading);
  assert.deepEqual(before, [
    "KpiCard",
    "KpiCard",
    "KpiCard",
    "KpiCard",
    "IncompleteCard",
    "MatchingCard",
    "StorageCard",
    "DistributionCard:resolution",
    "DistributionCard:codec",
    "DistributionCard:source",
    "DistributionCard:audio",
    "DistributionCard:language",
  ]);
  const shell = hosts(loading);
  // Placeholders: no value yet, but every card is there.
  assert.deepEqual(
    ofType(loading, "KpiCard").map((n) => n.props.model.value),
    [null, null, null, null],
  );
  assert.equal(ofType(loading, "IncompleteCard")[0].props.count, null);
  assert.equal(ofType(loading, "MatchingCard")[0].props.counts, null);
  assert.equal(ofType(loading, "MatchingCard")[0].props.files, null);
  for (const card of ofType(loading, "DistributionCard")) {
    assert.equal(card.props.buckets, null, card.props.field);
    assert.equal(card.props.total, null, card.props.field);
    assert.equal(card.props.files, null, card.props.field);
  }

  const loaded = await page.answer();
  assert.deepEqual(cardShape(loaded), before);
  assert.deepEqual(hosts(loaded), shell);
  assert.deepEqual(
    ofType(loaded, "KpiCard").map((n) => n.props.model.value),
    [26, 5, 123, 148],
  );
  assert.equal(ofType(loaded, "IncompleteCard")[0].props.count, 4);
  assert.deepEqual(
    plain(ofType(loaded, "MatchingCard")[0].props.counts),
    statistics.emby,
  );
  assert.equal(ofType(loaded, "MatchingCard")[0].props.files, 148);
  const [status2] = ofType(loaded, "p").filter((n) =>
    classes(n).includes("v2-sr-only"),
  );
  assert.equal(status2.props.role, "status", "the region stays");
  assert.equal(text(status2), "");
  // The 1.7.0 buckets and totals: SD grouped as the settings say, audio
  // by files and language by language totals.
  const cards = Object.fromEntries(
    ofType(loaded, "DistributionCard").map((n) => [n.props.field, n.props]),
  );
  assert.deepEqual(plain(cards.resolution.buckets), [
    { value: "1080p", count: 94 },
    { value: "", count: 1 },
    { value: "__sd__", count: 5 },
  ]);
  assert.equal(cards.resolution.total, 100);
  assert.equal(cards.codec.total, 148);
  assert.equal(cards.source.total, 0);
  assert.equal(cards.audio.total, 148);
  assert.equal(cards.language.total, 151);
  // Every head counts the scope's files (final review I4): the language
  // total (occurrences, 151) is no number of files; the shares keep
  // their totals above.
  for (const field of ["resolution", "codec", "source", "audio", "language"])
    assert.equal(cards[field].files, 148, field);
  tabsOf(loaded).props.select("sonarr");
  const series = Object.fromEntries(
    ofType(page.render(), "DistributionCard").map((n) => [
      n.props.field,
      n.props,
    ]),
  );
  assert.equal(series.language.files, 122);
  assert.equal(series.language.total, 124);

  // The page is a region named Dashboard (final review T10-2).
  assert.equal(loaded.type, "section");
  assert.deepEqual(classes(loaded), ["v2-dash"]);
  assert.equal(loaded.props["aria-label"], "Dashboard");
  // The header is the 1.7.0 one.
  const [header] = ofType(loaded, "PageHeader");
  assert.equal(header.props.title, "Dashboard");
  assert.equal(header.props.meta, "From the local cache");
});

test("a failed load offers retry", async () => {
  const page = dashboard();
  page.render();
  const failed = await page.fail();
  const [header] = ofType(failed, "PageHeader");
  // Retry sits in the header's fixed action slot, so nothing moves.
  const retry = nodes(header.props.actions).find(
    (n) => n.type === "button" && text(n) === "Retry",
  );
  assert.ok(retry, "Retry is offered");
  assert.equal(retry.props.type, "button");
  // The cards keep their placeholders.
  assert.deepEqual(
    ofType(failed, "KpiCard").map((n) => n.props.model.value),
    [null, null, null, null],
  );
  retry.props.onClick();
  const again = page.render();
  assert.deepEqual(page.calls.api, [
    ["statistics", "GET"],
    ["statistics", "GET"],
  ]);
  assert.equal(
    ofType(again, "PageHeader")[0].props.actions,
    undefined,
    "a new try clears the error",
  );
  const loaded = await page.answer();
  assert.deepEqual(
    ofType(loaded, "KpiCard").map((n) => n.props.model.value),
    [26, 5, 123, 148],
  );
});

// Final review T11-a: Retry leaves the page while its load runs, so focus
// falls to body; the load hands it on when it ends: to the page (main,
// without scrolling) once loaded, to Retry when it failed again. A user
// who moved focus meanwhile keeps it, and a load without Retry moves none.
test("a load after Retry hands focus on", async () => {
  const retryOf = (tree) =>
    nodes(ofType(tree, "PageHeader")[0].props.actions).find(
      (n) => n.type === "button" && text(n) === "Retry",
    );
  const page = dashboard();
  page.render();
  let tree = await page.fail();
  assert.deepEqual(page.calls.focus, [], "a first failure moves no focus");
  // As Preact would, the button is attached to its ref (one ref object
  // across renders).
  retryOf(tree).ref.current = {
    focus: (options) => page.calls.focus.push(["Retry", plain(options)]),
  };
  retryOf(tree).props.onClick();
  page.render();
  tree = await page.fail("Still not reachable");
  const retry = retryOf(tree);
  assert.deepEqual(page.calls.focus, [["Retry", { preventScroll: true }]]);
  retry.props.onClick();
  page.render();
  await page.answer();
  page.runtime.flush();
  assert.deepEqual(page.calls.focus.at(-1), ["main", { preventScroll: true }]);
  assert.equal(page.calls.focus.length, 2);
  // A later load (a sync) moves no focus.
  page.props.status.cacheRevision = 2;
  page.render();
  assert.equal(page.calls.api.length, 4, "the sync loads again");
  await page.answer();
  page.runtime.flush();
  assert.equal(page.calls.focus.length, 2);
  // Focus the user moved meanwhile stays where it is.
  const other = dashboard();
  other.render();
  tree = await other.fail();
  retryOf(tree).props.onClick();
  other.render();
  other.document.activeElement = { name: "a KPI card" };
  await other.answer();
  other.runtime.flush();
  assert.deepEqual(other.calls.focus, []);
});

test("KPI cards link to their lists", async () => {
  const page = dashboard();
  page.render();
  const tree = await page.answer();
  const kpis = ofType(tree, "KpiCard");
  assert.deepEqual(
    kpis.map((n) => [n.props.model.key, n.props.model.hero, n.props.href]),
    [
      ["movies", false, "#/movies"],
      ["series", false, "#/series"],
      ["episodes", false, "#/series"],
      ["files", true, "#/movies"],
    ],
  );
  for (const kpi of kpis) kpi.props.open();
  assert.deepEqual(page.calls.links, [
    { view: "library", service: "radarr", query: "" },
    { view: "library", service: "sonarr", query: "" },
    { view: "library", service: "sonarr", query: "" },
    { view: "library", service: "radarr", query: "" },
  ]);

  // The card itself: a NavLink with the label, value and detail, the
  // hero in its own class; a value of null keeps the line.
  const ICONS = new Proxy({}, { get: (_, name) => String(name) });
  const { KpiCard } = loadSource("components/dashboard/KpiCard.tsx", {
    modules: { "../../ui": ui, "lucide-preact": ICONS },
    stubs: PRESENTATION_MODULES,
  });
  const opened = [];
  const card = (value, hero) =>
    KpiCard({
      model: {
        key: hero ? "files" : "movies",
        label: hero ? "Media files" : "Movies",
        detail: "movie and episode files",
        value,
        hero,
        target: { view: "library", service: "radarr", query: "" },
      },
      href: "#/movies",
      open: () => opened.push(hero),
    });
  const plainCard = card(1234, false);
  assert.equal(plainCard.type, "NavLink");
  assert.equal(plainCard.props.href, "#/movies");
  assert.equal(plainCard.props.class, "v2-kpi");
  assert.equal(plainCard.props.label, undefined, "named by its text");
  assert.equal(text(plainCard), "Movies1,234movie and episode files");
  assert.equal(byClass(plainCard, "v2-tile--grad").length, 1);
  plainCard.props.open();
  const hero = card(148, true);
  assert.equal(hero.props.class, "v2-kpi v2-kpi--hero");
  assert.equal(byClass(hero, "v2-tile--grad").length, 0);
  assert.equal(
    text(byClass(card(null, false), "v2-kpi-value")[0]),
    NBSP,
    "a placeholder keeps the value's line",
  );
  assert.deepEqual(opened, [false]);
  // The arrow and the tile are decoration.
  for (const part of [
    ...byClass(hero, "v2-kpi-go"),
    ...byClass(hero, "v2-tile"),
  ])
    assert.equal(part.props["aria-hidden"], "true");
});

test("distribution values link like the 1.7.0 chart", async () => {
  for (const [scope, service, base] of [
    ["all", "radarr", "#/movies"],
    ["all", "sonarr", "#/series"],
    ["radarr", "sonarr", "#/movies"],
    ["sonarr", "radarr", "#/series"],
  ]) {
    const page = dashboard({
      service,
      stored: { "scopearr-dashboard-scope": scope },
    });
    page.render();
    const tree = await page.answer();
    const resolutionCard = ofType(tree, "DistributionCard").find(
      (n) => n.props.field === "resolution",
    );
    assert.equal(
      resolutionCard.props.hrefOf("2160p"),
      base + "?resolution=2160p",
      scope + " " + service,
    );
    assert.equal(
      resolutionCard.props.hrefOf(""),
      base + "?resolution=__unknown__",
    );
    resolutionCard.props.open("2160p");
    assert.deepEqual(page.calls.filters, [["resolution", "2160p", scope]]);
    // Incomplete metadata's Show opens its filter the same way.
    const [incomplete] = ofType(tree, "IncompleteCard");
    assert.equal(incomplete.props.href, base + "?metadata=incomplete");
    incomplete.props.open();
    assert.deepEqual(page.calls.filters.at(-1), [
      "metadata",
      "incomplete",
      scope,
    ]);
  }

  // The scope tabs choose and remember the scope.
  const page = dashboard();
  const tree = page.render();
  const [tabs] = ofType(tree, "Segmented");
  assert.equal(tabs.props.kind, "tabs");
  assert.equal(tabs.props.label, "Statistics scope");
  assert.equal(tabs.props.idPrefix, "dashboard-scope");
  assert.deepEqual(plain(tabs.props.items), [
    { value: "all", label: "Entire library" },
    { value: "radarr", label: "Movies" },
    { value: "sonarr", label: "TV series" },
  ]);
  const [panel] = byClass(tree, "v2-dash-grid");
  assert.equal(panel.props.role, "tabpanel");
  assert.equal(panel.props.id, "dashboard-scope-panel-all");
  assert.equal(panel.props["aria-labelledby"], "dashboard-scope-tab-all");
  tabs.props.select("sonarr");
  const series = page.render();
  assert.deepEqual(page.calls.writes, [["scopearr-dashboard-scope", "sonarr"]]);
  assert.equal(
    byClass(series, "v2-dash-grid")[0].props.id,
    "dashboard-scope-panel-sonarr",
  );
  assert.equal(ofType(series, "StorageCard")[0].props.scope, "sonarr");

  // The card: each value a NavLink named as the 1.7.0 button, to hrefOf
  // and open of its value, its tag (flag and name for a language), count,
  // percent and a bar in --chart-1 (Unknown: --muted).
  const rows = distribution({
    field: "resolution",
    buckets: [
      { value: "1080p", count: 3 },
      { value: "", count: 1 },
    ],
    total: 4,
  });
  const card = rows.render();
  const links = ofType(card, "NavLink");
  assert.deepEqual(
    links.map((n) => [n.props.href, n.props.label]),
    [
      ["href:1080p", "Filter Resolution: 1080p"],
      ["href:", "Filter Resolution: Unknown"],
    ],
  );
  assert.deepEqual(
    ofType(card, "MediaTag").map((n) => [n.props.value, n.props.kind]),
    [
      ["1080p", "resolution"],
      ["", "resolution"],
    ],
  );
  links[1].props.open();
  assert.deepEqual(rows.opened, [""]);
  const row = byClass(card, "v2-dist-row")[0];
  assert.deepEqual(byClass(row, "v2-dist-n").map(text), ["3"]);
  assert.deepEqual(byClass(row, "v2-dist-pct").map(text), ["75\u202f%"]);
  const bars = byClass(card, "v2-dist-bar");
  assert.deepEqual(
    bars.map((n) => [
      classes(n).includes("v2-dist-bar--unknown"),
      n.props["aria-hidden"],
    ]),
    [
      [false, "true"],
      [true, "true"],
    ],
  );
  assert.equal(bars[0].props.children.props.style.width, "75%");
  // A language row: flag and name, named by the language.
  const language = distribution({
    field: "language",
    buckets: [{ value: "German", count: 2 }],
    total: 4,
  }).render();
  const [flagLink] = ofType(language, "NavLink");
  assert.equal(flagLink.props.label, "Filter Language: Deutsch");
  assert.deepEqual(
    ofType(flagLink, "LanguageFlag").map((n) => [
      n.props.value,
      n.props.focusable,
    ]),
    [["German", false]],
  );
  assert.match(text(flagLink), /Deutsch/);
  // Audio heads its card "Audio" as in 1.7.0, its filter name says the codec.
  const audio = distribution({
    field: "audio",
    buckets: [{ value: "DTS", count: 2 }],
    total: 4,
  }).render();
  assert.equal(text(ofType(audio, "h3")[0]), "Audio");
  assert.equal(
    ofType(audio, "NavLink")[0].props.label,
    "Filter Audio codec: DTS",
  );
});

// --- DistributionCard ---------------------------------------------------

function distribution(props, { colors = {} } = {}) {
  const runtime = createHookRuntime({
    contexts: new Map([[ui.TagLabels, { "codec:x265": "HEVC" }]]),
  });
  const opened = [];
  const { DistributionCard } = loadSource(
    "components/dashboard/DistributionCard.tsx",
    {
      modules: {
        "preact/hooks": runtime.hooks,
        "../../i18n": i18n,
        "../../ui": ui,
        "../../dashboard-model": model,
        "../../tag-labels": tagLabels,
        "../../languages": {
          audioLanguageLabel: (value) =>
            ({ German: "Deutsch", English: "English" })[value] ?? value,
        },
        "../LanguageFlag": { LanguageFlag: "LanguageFlag" },
      },
      stubs: PRESENTATION_MODULES,
    },
  );
  const all = {
    hrefOf: (value) => "href:" + value,
    open: (value) => opened.push(value),
    ...props,
  };
  return {
    opened,
    colors,
    render: () => runtime.settle(() => DistributionCard(all)),
  };
}

test("distribution cards keep their height and show five, then all", () => {
  const buckets = ["a", "b", "c", "d", "e", "f", "g"].map((value, i) => ({
    value,
    count: 10 - i,
  }));
  const loading = distribution({
    field: "codec",
    buckets: null,
    total: null,
    files: null,
  }).render();
  // The head counts the scope's files (52), the shares divide by the
  // card's total (49; final review I4).
  const card = distribution({ field: "codec", buckets, total: 49, files: 52 });
  const loaded = card.render();
  const empty = distribution({
    field: "codec",
    buckets: [],
    total: 0,
    files: 0,
  }).render();
  // One card, head and body in every state: the body reserves five rows
  // and the More row (--dist-body-min).
  for (const tree of [loading, loaded, empty]) {
    assert.deepEqual(classes(tree), ["v2-card", "v2-dist"]);
    assert.equal(tree.type, "article");
    assert.equal(byClass(tree, "v2-dist-head").length, 1);
    assert.equal(byClass(tree, "v2-dist-body").length, 1);
    assert.equal(text(ofType(tree, "h3")[0]), "Codec / encoder");
  }
  assert.equal(byClass(loading, "v2-dist-row").length, 0);
  assert.equal(text(byClass(loading, "v2-dist-sub")[0]), NBSP);
  assert.equal(
    byClass(loading, "v2-empty").length,
    0,
    "loading is no empty state",
  );
  assert.equal(text(byClass(loaded, "v2-dist-sub")[0]), "52 files");
  assert.deepEqual(
    byClass(loaded, "v2-dist-bar").map(
      (bar) => bar.props.children.props.style.width,
    ),
    [10, 9, 8, 7, 6].map((n) => (n * 100) / 49 + "%"),
  );
  assert.match(text(byClass(empty, "v2-empty")[0]), /No files in cache yet/);
  assert.equal(byClass(empty, "v2-dist-row").length, 0);

  // Five rows, More; then all, Less; then five again.
  assert.deepEqual(
    byClass(loaded, "v2-dist-row").map(
      (row) => ofType(row, "MediaTag")[0].props.value,
    ),
    ["a", "b", "c", "d", "e"],
  );
  const more = ofType(loaded, "button").find((n) => text(n) === "More");
  assert.equal(more.props["aria-expanded"], false);
  assert.ok(classes(more).includes("v2-text-btn"));
  more.props.onClick();
  const all = card.render();
  assert.equal(byClass(all, "v2-dist-row").length, 7);
  const less = ofType(all, "button").find((n) => text(n) === "Less");
  assert.equal(less.props["aria-expanded"], true);
  less.props.onClick();
  assert.equal(byClass(card.render(), "v2-dist-row").length, 5);
  // Five values or fewer: no More.
  const five = distribution({
    field: "codec",
    buckets: buckets.slice(0, 5),
    total: 40,
  }).render();
  assert.equal(ofType(five, "button").length, 0);
});

// --- MatchingCard -------------------------------------------------------

test("the matching card shows four groups with help and no links", () => {
  const { MatchingCard } = loadSource("components/dashboard/MatchingCard.tsx", {
    modules: {
      "../../i18n": i18n,
      "../../ui": ui,
      "../../media-matching": matching,
      "../list/HelpTip": { HelpTip: "HelpTip" },
    },
    stubs: PRESENTATION_MODULES,
  });
  const loaded = MatchingCard({ counts: statistics.emby, files: 148 });
  const loading = MatchingCard({ counts: null, files: null });
  for (const tree of [loaded, loading]) {
    assert.equal(tree.type, "article");
    assert.deepEqual(classes(tree), ["v2-card", "v2-widget"]);
    assert.equal(text(ofType(tree, "h2")[0]), "Media server matching");
    assert.equal(ofType(tree, "li").length, 4);
    assert.equal(ofType(tree, "a").length + ofType(tree, "NavLink").length, 0);
    assert.equal(byClass(tree, "v2-match")[0].props["aria-hidden"], "true");
  }
  const items = ofType(loaded, "li");
  assert.deepEqual(
    items.map((li) => [
      classes(li)[0],
      text(li).replace(/\d[\d,]*$/, ""),
      ofType(li, "HelpTip")[0].props.label,
      ofType(li, "HelpTip")[0].props.text,
      text(byClass(li, "v2-match-n")[0]),
    ]),
    plain(matching.matchingGroups).map((group, i) => [
      ["v2-match--ok", "v2-match--error", "v2-match--warn", "v2-match--off"][i],
      group.label,
      group.label,
      group.help,
      ["3", "3", "2", "140"][i],
    ]),
  );
  assert.equal(text(byClass(loaded, "v2-widget-sub")[0]), "148 files");
  // The bar stacks the groups with a count, in the list's tones.
  assert.deepEqual(
    ofType(byClass(loaded, "v2-match")[0], "span").map((n) => [
      n.props.class,
      n.props.style.flexGrow,
    ]),
    [
      ["v2-match--ok", 3],
      ["v2-match--error", 3],
      ["v2-match--warn", 2],
      ["v2-match--off", 140],
    ],
  );
  assert.deepEqual(
    ofType(
      byClass(
        MatchingCard({ counts: { matched: 4 }, files: 4 }),
        "v2-match",
      )[0],
      "span",
    ).map((n) => n.props.class),
    ["v2-match--ok"],
    "a group without files has no segment",
  );
  // Loading: the lines and the sub-line hold their place.
  assert.deepEqual(byClass(loading, "v2-match-n").map(text), [
    NBSP,
    NBSP,
    NBSP,
    NBSP,
  ]);
  assert.equal(text(byClass(loading, "v2-widget-sub")[0]), NBSP);
  assert.equal(ofType(byClass(loading, "v2-match")[0], "span").length, 0);
});

// --- IncompleteCard -----------------------------------------------------

test("incomplete metadata shows its count and opens its filter", () => {
  const { IncompleteCard } = loadSource(
    "components/dashboard/IncompleteCard.tsx",
    {
      modules: { "../../i18n": i18n, "../../ui": ui },
      stubs: PRESENTATION_MODULES,
    },
  );
  const opened = [];
  const loaded = IncompleteCard({
    count: 1234,
    href: "#/movies?metadata=incomplete",
    open: () => opened.push("show"),
  });
  const loading = IncompleteCard({ count: null, href: "#/x", open() {} });
  for (const tree of [loaded, loading]) {
    assert.deepEqual(classes(tree), ["v2-card", "v2-widget"]);
    assert.equal(text(ofType(tree, "h2")[0]), "Incomplete metadata");
    assert.match(
      text(tree),
      /Resolution, codec, source, audio and language; HDR may be SDR or unknown\./,
    );
  }
  assert.equal(text(byClass(loaded, "v2-widget-num")[0]), "1,234");
  assert.equal(text(byClass(loading, "v2-widget-num")[0]), NBSP);
  // Show: the filter's 1.7.0 name after its visible text (WCAG 2.5.3).
  const [show] = ofType(loaded, "NavLink");
  assert.equal(show.props.href, "#/movies?metadata=incomplete");
  assert.equal(text(show), "Show");
  assert.equal(show.props.label, "Show · Filter Metadata status: incomplete");
  show.props.open();
  assert.deepEqual(opened, ["show"]);
  assert.equal(ofType(loading, "NavLink").length, 1, "Show is always there");
});

// --- StorageCard --------------------------------------------------------

function storage({ data, fail = false, stored, scope = "all" } = {}) {
  const runtime = createHookRuntime();
  const writes = [];
  const polls = [];
  const settings = settingsWith(ALL, ALL, {});
  settings.widgets.storage = { radarr: [{ path: "/movies", sharedGroup: "" }] };
  const { StorageCard } = loadSource("components/dashboard/StorageCard.tsx", {
    modules: {
      "preact/hooks": runtime.hooks,
      "../../i18n": i18n,
      "../../ui": ui,
      "../../api": {
        api: async (path) => {
          if (fail) throw new Error("down");
          assert.equal(path, "storage");
          return data;
        },
      },
      "../../browser-storage": {
        readPreference: (key) =>
          key === "scopearr-storage-areas" ? (stored ?? null) : null,
        writePreference: (key, value) => writes.push([key, value]),
      },
      "../../dashboard-model": model,
      "../../hooks/usePolling": {
        usePolling: (load, next, deps) => polls.push({ load, next, deps }),
      },
    },
    stubs: PRESENTATION_MODULES,
  });
  const props = { settings, scope };
  const render = () => runtime.settle(() => StorageCard(props));
  return {
    writes,
    polls,
    props,
    render,
    async poll() {
      const signal = new AbortController().signal;
      await polls.at(-1).load(signal);
      return render();
    },
  };
}
const area = (key, label, used, total, error = "") => ({
  key,
  label,
  paths: ["/mnt/" + key],
  total,
  used,
  free: total - used,
  error,
});

test("the storage card keeps the 1.7.0 storage functions", async () => {
  const data = {
    services: {},
    areas: {
      all: [
        area("a", "radarr · Movies", 1e12, 4e12),
        area(
          "b",
          "sonarr · Shows",
          3e12,
          4e12,
          "Storage readings are stale or unavailable",
        ),
      ],
      radarr: [area("a", "radarr · Movies", 1e12, 4e12)],
      sonarr: [],
    },
  };
  const card = storage({ data, stored: '{"all":"a"}' });
  const loading = card.render();
  // Every 60 s, restarted when the storage paths change.
  assert.equal(card.polls.at(-1).next(), 60000);
  assert.deepEqual(plain(card.polls.at(-1).deps), [
    JSON.stringify(card.props.settings.widgets.storage),
  ]);
  assert.deepEqual(classes(loading), ["v2-card", "v2-widget"]);
  assert.equal(text(ofType(loading, "h2")[0]), "Storage");
  // Before the first answer: the ring's place with its track, no hint.
  assert.equal(byClass(loading, "v2-ring").length, 1);
  assert.equal(byClass(loading, "v2-ring-note").length, 0);
  assert.equal(byClass(loading, "v2-ring-arc").length, 0);
  assert.equal(text(byClass(loading, "v2-widget-sub")[0]), NBSP);

  const shown = await card.poll();
  assert.equal(text(byClass(shown, "v2-widget-sub")[0]), "Movies");
  assert.equal(byClass(shown, "v2-widget-sub")[0].props.title, "/mnt/a");
  const [chart] = byClass(shown, "v2-ring-chart");
  assert.equal(chart.props.role, "img");
  assert.equal(chart.props["aria-label"], "1 TB used · 3 TB free");
  assert.equal(chart.props.title, "/mnt/a");
  assert.equal(text(byClass(shown, "v2-ring-value")[0]), "25\u202f%");
  // Used and free in the user's colors, on the ring and in the legend.
  assert.deepEqual(
    byClass(shown, "v2-ring-arc").map((n) => n.props.stroke),
    ["#ff0000", "#00ff00"],
  );
  const legend = byClass(shown, "v2-ring-legend")[0];
  assert.deepEqual(
    ofType(legend, "div").map((row) => [
      text(ofType(row, "dt")[0]),
      text(ofType(row, "dd")[0]),
      ofType(row, "span")[0].props.style?.background,
    ]),
    [
      ["Used space", "1 TB", "#ff0000"],
      ["Free space", "3 TB", "#00ff00"],
      ["Total space", "4 TB", undefined],
    ],
  );
  // The areas of the scope, one step at a time, remembered per scope.
  const group = nodes(shown).find((n) => n.props?.role === "group");
  assert.equal(group.props["aria-label"], "Storage area");
  const [previous, next] = ofType(group, "button");
  assert.deepEqual(
    [previous.props["aria-label"], next.props["aria-label"]],
    ["Previous storage area", "Next storage area"],
  );
  assert.equal(previous.props.disabled, false);
  next.props.onClick();
  const second = card.render();
  assert.equal(text(byClass(second, "v2-widget-sub")[0]), "Shows");
  assert.deepEqual(card.writes.at(-1), [
    "scopearr-storage-areas",
    '{"all":"b"}',
  ]);
  // An area's own error reads under the legend.
  assert.equal(
    text(byClass(second, "v2-ring-error")[0]),
    "Storage readings are stale or unavailable",
  );
  ofType(
    nodes(second).find((n) => n.props?.role === "group"),
    "button",
  )[0].props.onClick();
  assert.equal(text(byClass(card.render(), "v2-widget-sub")[0]), "Movies");
  assert.deepEqual(card.writes.at(-1), [
    "scopearr-storage-areas",
    '{"all":"a"}',
  ]);

  // One area: the buttons stay, disabled.
  card.props.scope = "radarr";
  const one = card.render();
  const buttons = ofType(
    nodes(one).find((n) => n.props?.role === "group"),
    "button",
  );
  assert.deepEqual(
    buttons.map((n) => n.props.disabled),
    [true, true],
  );
  // No area: the 1.7.0 hint in the ring's place, without the buttons.
  card.props.scope = "sonarr";
  const none = card.render();
  assert.equal(
    text(byClass(none, "v2-ring-note")[0]),
    "Select storage paths in Settings → Widgets.",
  );
  assert.equal(byClass(none, "v2-ring")[0] !== undefined, true);
  assert.equal(
    nodes(none).find((n) => n.props?.role === "group"),
    undefined,
  );
  // A failed reading.
  const failed = storage({ fail: true });
  failed.render();
  const down = await failed.poll();
  assert.equal(
    text(byClass(down, "v2-ring-note")[0]),
    "Storage readings are stale or unavailable",
  );
  // A broken stored choice falls back to the first area.
  const broken = storage({ data, stored: "{" });
  broken.render();
  assert.equal(
    text(byClass(await broken.poll(), "v2-widget-sub")[0]),
    "Movies",
  );
});

// --- Widgets ------------------------------------------------------------

test("widgets follow the settings order and visibility", async () => {
  const page = dashboard({
    settings: settingsWith(
      ["language", "storage", "codec", "resolution", "audio", "source"],
      ["codec", "language", "storage"],
    ),
  });
  page.render();
  const tree = await page.answer();
  // Storage sits in the widget row (ruling R-E); the distributions follow
  // the order of the settings.
  const [row] = byClass(tree, "v2-dash-row");
  assert.deepEqual(
    nodes(row)
      .filter((n) => /Card$/.test(n.type))
      .map((n) => n.type),
    ["IncompleteCard", "MatchingCard", "StorageCard"],
  );
  const [grid] = byClass(tree, "v2-dash-grid");
  assert.deepEqual(
    ofType(grid, "DistributionCard").map((n) => n.props.field),
    ["language", "codec"],
  );
  assert.equal(ofType(tree, "StorageCard")[0].props.scope, "all");
  assert.doesNotMatch(text(tree), /No dashboard widgets selected\./);

  // Storage hidden: the row keeps its two cards.
  const noStorage = dashboard({
    settings: settingsWith(ALL, ["resolution"]),
  });
  noStorage.render();
  const two = await noStorage.answer();
  assert.equal(ofType(two, "StorageCard").length, 0);
  assert.deepEqual(
    ofType(two, "DistributionCard").map((n) => n.props.field),
    ["resolution"],
  );

  // Only storage: no note, the storage card shows.
  const storageOnly = dashboard({ settings: settingsWith(ALL, ["storage"]) });
  storageOnly.render();
  const alone = await storageOnly.answer();
  assert.equal(ofType(alone, "StorageCard").length, 1);
  assert.doesNotMatch(text(alone), /No dashboard widgets selected\./);

  // Nothing selected: the 1.7.0 note in the grid.
  const none = dashboard({ settings: settingsWith(ALL, []) });
  none.render();
  const empty = await none.answer();
  assert.equal(ofType(empty, "DistributionCard").length, 0);
  assert.equal(ofType(empty, "StorageCard").length, 0);
  assert.match(
    text(byClass(empty, "v2-dash-grid")[0]),
    /No dashboard widgets selected\./,
  );
  // Without settings: every widget in the 1.7.0 order.
  const fallback = dashboard({ settings: null });
  fallback.render();
  const defaults = await fallback.answer();
  assert.deepEqual(
    ofType(defaults, "DistributionCard").map((n) => n.props.field),
    ["resolution", "codec", "source", "audio", "language"],
  );
  assert.equal(
    ofType(defaults, "StorageCard").length,
    0,
    "storage needs settings",
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import * as preact from "preact";
import { loadSource, nodes, text } from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";
import * as audioChannels from "../src/audio-channels.ts";
import * as color from "../src/color.ts";
import * as entryLink from "../src/entry-link.ts";
import * as fileSelection from "../src/file-selection.ts";
import * as instances from "../src/instances.ts";
import * as mediaLink from "../src/media-link.ts";
import * as muxSpec from "../src/mux-spec.ts";
import * as resolution from "../src/resolution-groups.ts";
import * as tagDisplay from "../src/tag-display.ts";
import * as tagLabels from "../src/tag-labels.ts";
import * as units from "../src/units.ts";

// The media table of the libraries (Phase 5a, task 6; docs/STYLEGUIDE.md,
// Part 1, 10.10): MediaTable with TitleCell, TitleMarks, InfoButtons,
// MediaLinkButton and CustomTagsCell, built but not mounted yet. Each
// component runs as real code; the building blocks it places (RowButton,
// RowMark, MediaTag, SelectionBox, SortHeader, the cells of other tasks)
// are named stubs, so a tree shows what they receive.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");
const i18n = { t, getLocale: () => "en", useI18n: () => ({ locale: "en" }) };

// Every module shares one hooks object; it calls the runtime that renders.
let current = createHookRuntime();
const hooks = new Proxy({}, { get: (_, name) => current.hooks[name] });
// The real ui.tsx: ICON, bytes, the column labels, the default warning
// colors and the tag contexts.
const ui = loadSource("ui.tsx", {
  modules: {
    "./units": units,
    "./i18n": i18n,
    "./resolution-groups": resolution,
    "./tag-labels": tagLabels,
    "./color": color,
    "./tag-display": tagDisplay,
    preact,
    "preact/compat": { createPortal: (vnode) => vnode },
    "preact/hooks": hooks,
  },
});

// A component with its own runtime and tag contexts; render() renders it
// again with the same state (after a click), as Preact would.
function mount(component, props, contexts = new Map()) {
  const runtime = createHookRuntime({ contexts });
  return {
    render() {
      current = runtime;
      return runtime.render(() => component(props));
    },
  };
}
const once = (component, props, contexts) =>
  mount(component, props, contexts).render();

const classes = (node) => (node?.props?.class ?? "").split(" ");
const byClass = (tree, name) =>
  nodes(tree).filter((n) => classes(n).includes(name));
const ofType = (tree, type) => nodes(tree).filter((n) => n.type === type);
// A value of the sandbox as data of this realm.
const data = (value) => JSON.parse(JSON.stringify(value ?? null));
// The children of a node without the holes (null, false) a condition leaves.
const kids = (node) =>
  [node?.props?.children]
    .flat(Infinity)
    .filter((child) => child !== null && child !== false && child !== "");

const STUBS = {
  "../list/RowButton": { RowButton: "RowButton" },
  "../list/RowMark": { RowMark: "RowMark" },
  "../list/MediaTag": { MediaTag: "MediaTag" },
  "../list/CustomTag": { CustomTag: "CustomTag" },
  "../list/SortHeader": { SortHeader: "SortHeader" },
  "../SelectionBox": { SelectionBox: "SelectionBox" },
  "../frame/Popover": { Popover: "Popover" },
};
const library = (name, modules = {}) =>
  loadSource("components/library/" + name + ".tsx", {
    modules: {
      preact,
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../../instances": instances,
      "../../entry-link": entryLink,
      "../../media-link": mediaLink,
      "../../mux-spec": muxSpec,
      "../../tag-display": tagDisplay,
      "../../file-selection": fileSelection,
      "../../audio-channels": audioChannels,
      ...STUBS,
      ...modules,
    },
  });
// The modules as the table uses them; the cells of other tasks and the
// table's own cells as named stubs unless real ones are asked for.
function modules({ real = [] } = {}) {
  const info = library("InfoButtons", {
    "./MediaLinkButton": { MediaLinkButton: "MediaLinkButton" },
  });
  const marks = library("TitleMarks", { "./InfoButtons": info });
  const title = library("TitleCell", {
    "./TitleMarks": real.includes("TitleMarks")
      ? marks
      : { TitleMarks: "TitleMarks" },
  });
  const media = library("MediaLinkButton");
  const custom = library("CustomTagsCell");
  const table = library("MediaTable", {
    "./TitleCell": { TitleCell: "TitleCell" },
    "./InfoButtons": { InfoButtons: "InfoButtons" },
    "./CustomTagsCell": { CustomTagsCell: "CustomTagsCell" },
    "./TracksCell": { TracksCell: "TracksCell" },
  });
  return { ...info, ...marks, ...title, ...media, ...custom, ...table };
}

// --- Fixtures ----------------------------------------------------------------

const ORDER = ["link", "media", "details", "metadata", "recognition", "mux"];
const instance = (id, type, fields = {}) => ({
  id,
  type,
  name: "",
  enabled: true,
  url: "http://" + id + ".local",
  hasKey: false,
  interval: 0,
  ...fields,
});
const settings = (fields = {}) => ({
  instances: [instance("radarr", "radarr"), instance("sonarr", "sonarr")],
  listInfoOrder: ORDER,
  listInfoVisible: ORDER,
  warningColors: { metadata: "#e0a020", recognition: "#a080f0" },
  seasonMode: "matches",
  ...fields,
});
const movie = (fields = {}) => ({
  id: 1,
  service: "radarr",
  mediaId: 7,
  title: "Arrival",
  series: "",
  season: 0,
  episodes: [],
  years: [2016],
  filename: "Arrival.2016.2160p.mkv",
  resolution: "2160p",
  codec: "x265",
  family: "HEVC",
  source: "WEB-DL",
  processing: "Remux",
  hdr: "HDR10 + Dolby Vision",
  bitDepth: "10",
  audio: "DTS + AC-3",
  audioStreamCount: 2,
  channels: "5.1 + 2.0",
  language: "Deutsch, Englisch",
  size: 42e9,
  conflict: false,
  ruleConflict: false,
  evidence: {},
  matched: true,
  metadataIncomplete: false,
  custom: [],
  informationOnly: { source: ["WEB-DL"] },
  ...fields,
});
const episode = (id, season, number, fields = {}) =>
  movie({
    id,
    service: "sonarr",
    mediaId: 21,
    series: "Dark",
    season,
    episodes: [{ id: id * 10, number, title: "Episode " + id, year: 2017 }],
    years: [2017],
    title: "Episode " + id,
    filename: `Dark.S0${season}E0${number}.mkv`,
    ...fields,
  });
const selection = (fields = {}) => {
  const calls = [];
  return {
    calls,
    selected: {},
    keys: [],
    busy: false,
    toggle: (keys, checked) => calls.push(["toggle", data(keys), checked]),
    group: (...args) => calls.push(["group", ...args]),
    clear() {},
    ...fields,
  };
};
const tableProps = (fields = {}) => ({
  files: [movie()],
  placeholders: 0,
  service: "radarr",
  settings: settings(),
  columns: ["info", "title", "year", "resolution"],
  sort: { field: "title", direction: "asc" },
  onSort() {},
  selection: selection(),
  muxJobs: [],
  openMux() {},
  openDetails() {},
  editTags() {},
  stacked: false,
  onTrackFilter() {},
  ...fields,
});
const table = (fields) => modules().MediaTable(tableProps(fields));
const head = (tree) => ofType(ofType(tree, "thead")[0], "tr")[0];
const bodyRows = (tree) => kids(ofType(tree, "tbody")[0]).flatMap(rowsOf);
// The rows of a tbody child: a row, or the rows inside a fragment or a
// TagInformation provider.
function rowsOf(node) {
  if (!node || typeof node !== "object") return [];
  if (node.type === "tr") return [node];
  return kids(node).flatMap(rowsOf);
}
const cells = (row) => kids(row);

// --- MediaTable --------------------------------------------------------------

test("columns follow the saved order and visibility", () => {
  const columns = [
    "custom",
    "title",
    "year",
    "size",
    "audio",
    "info",
    "bitDepth",
    "channels",
    "hdr",
    "resolution",
    "codec",
    "source",
    "processing",
  ];
  const sorted = [];
  const props = tableProps({ columns, onSort: (field) => sorted.push(field) });
  const tree = modules().MediaTable(props);
  assert.equal(tree.type, "table");
  assert.equal(tree.props.class, "v2-table");

  // The header: the page box first, then a SortHeader per column in the
  // saved order, named by its column; numbers right, the title growing,
  // the audio tracks with their sort menu.
  const [box, ...headers] = cells(head(tree));
  assert.equal(box.type, "th");
  assert.equal(box.props.class, "v2-table-sel");
  assert.equal(box.props.scope, "col");
  assert.ok(headers.every((h) => h.type === "SortHeader"));
  assert.deepEqual(
    headers.map((h) => [
      h.props.field,
      h.props.label,
      !!h.props.numeric,
      !!h.props.grow,
      data(h.props.menu),
    ]),
    [
      ["custom", "Custom", false, false, null],
      ["title", "Title", false, true, null],
      ["year", "Year", true, false, null],
      ["size", "Size", true, false, null],
      [
        "audio",
        "Audio tracks",
        false,
        false,
        {
          fields: [
            { field: "audio", label: "Audio tracks" },
            { field: "channels", label: "Channels" },
          ],
        },
      ],
      ["info", "Info", false, false, null],
      ["bitDepth", "Bit depth", true, false, null],
      ["channels", "Channels", false, false, null],
      ["hdr", "HDR", false, false, null],
      ["resolution", "Resolution", false, false, null],
      ["codec", "Codec", false, false, null],
      ["source", "Source", false, false, null],
      ["processing", "Processing", false, false, null],
    ],
  );
  assert.ok(headers.every((h) => h.props.sort === props.sort));
  headers[2].props.onSort("year");
  assert.deepEqual(sorted, ["year"]);

  // A row: the selection cell, then one cell per column in the same order.
  const [row] = bodyRows(tree);
  const [sel, ...tds] = cells(row);
  assert.equal(sel.props.class, "v2-table-sel");
  assert.deepEqual(
    tds.map((td) => [td.type, td.props.class ?? ""]),
    [
      ["td", "v2-table-wide"],
      ["td", "v2-table-title"],
      ["td", "v2-table-num"],
      ["td", "v2-table-num"],
      ["td", "v2-table-wide"],
      ["td", "v2-table-info"],
      ["td", "v2-table-num"],
      ["td", ""],
      ["td", ""],
      ["td", ""],
      ["td", ""],
      ["td", ""],
      ["td", ""],
    ],
  );
  const content = (field) => kids(tds[columns.indexOf(field)]);
  const [file] = props.files;
  // Numbers as text; a missing year reads —.
  assert.deepEqual(content("year"), ["2016"]);
  assert.deepEqual(content("size"), ["42 GB"]);
  // Media tags as 1.7.0 rendered them, hidden values respected.
  const tag = (field) =>
    content(field).map((n) =>
      n.type === "MediaTag"
        ? data(n.props)
        : [n.props.class, ...kids(n).map((k) => data(k.props))],
    );
  assert.deepEqual(tag("resolution"), [
    { respectHidden: true, value: "2160p", kind: "resolution" },
  ]);
  assert.deepEqual(tag("codec"), [
    { respectHidden: true, value: "x265", kind: "codec", title: "HEVC" },
  ]);
  assert.deepEqual(tag("source"), [{ respectHidden: true, value: "WEB-DL" }]);
  assert.deepEqual(tag("processing"), [
    { respectHidden: true, value: "Remux", kind: "processing" },
  ]);
  assert.deepEqual(tag("bitDepth"), [
    { respectHidden: true, value: "10", kind: "bitDepth" },
  ]);
  assert.deepEqual(tag("hdr"), [
    [
      "v2-table-items",
      { respectHidden: true, value: "HDR10", kind: "hdr" },
      { respectHidden: true, value: "Dolby Vision", kind: "hdr" },
    ],
  ]);
  // Channels: a tag per track, laid out as the audio tracks.
  assert.deepEqual(tag("channels"), [
    [
      "v2-trk-row",
      { respectHidden: true, value: "5.1", kind: "channels" },
      { respectHidden: true, value: "2.0", kind: "channels" },
    ],
  ]);
  // The cells of other tasks get the file and their actions.
  const [tracks] = content("audio");
  assert.equal(tracks.type, "TracksCell");
  assert.equal(tracks.props.file, file);
  assert.equal(tracks.props.stacked, false);
  assert.equal(tracks.props.onFilter, props.onTrackFilter);
  const edited = [];
  props.editTags = (f) => edited.push(f.title);
  const [custom] = kids(
    cells(bodyRows(modules().MediaTable(props))[0])[
      1 + columns.indexOf("custom")
    ],
  );
  assert.equal(custom.type, "CustomTagsCell");
  assert.equal(custom.props.file, file);
  assert.equal(custom.props.settings, props.settings);
  custom.props.edit();
  assert.deepEqual(edited, ["Arrival"]);
  const [info] = content("info");
  assert.equal(info.type, "InfoButtons");
  assert.equal(info.props.file, file);
  assert.equal(info.props.settings, props.settings);

  // Stacked tracks stack the channels too; a file without a year reads —.
  const stacked = modules().MediaTable(
    tableProps({
      columns: ["year", "channels", "audio"],
      stacked: true,
      files: [movie({ years: [] })],
    }),
  );
  const [, year, channels, audio] = cells(bodyRows(stacked)[0]);
  assert.deepEqual(kids(year), ["—"]);
  assert.equal(kids(channels)[0].props.class, "v2-trk-stack");
  assert.equal(kids(audio)[0].props.stacked, true);

  // Hidden columns are not there; the title of TV series reads Episode.
  const series = modules().MediaTable(
    tableProps({
      service: "sonarr",
      columns: ["title", "size"],
      files: [episode(1, 1, 1)],
      sort: { field: "size", direction: "asc" },
    }),
  );
  assert.deepEqual(
    cells(head(series))
      .slice(1)
      .map((h) => h.props.label),
    ["Episode", "Size"],
  );
  assert.equal(cells(bodyRows(series)[0]).length, 3);
});

test("title cells keep their lines", () => {
  const { TitleCell, MediaTable } = modules();
  const lines = (tree) =>
    kids(tree).map((line) =>
      line.props.class === "v2-table-line"
        ? [
            line.props.class,
            text(kids(line)[0]),
            kids(line)[0].props.title,
            kids(line)[1].type,
          ]
        : [line.props.class, text(line), line.props.title],
    );
  const base = {
    service: "radarr",
    sort: { field: "title", direction: "asc" },
    settings: settings(),
    openMux() {},
    openDetails() {},
  };
  // A movie: its title, then its filename (new in 2.0.0).
  assert.deepEqual(lines(TitleCell({ ...base, file: movie() })), [
    ["v2-table-line", "Arrival", "Arrival", "TitleMarks"],
    ["v2-table-sub", "Arrival.2016.2160p.mkv", "Arrival.2016.2160p.mkv"],
  ]);
  // With more than one instance its name comes first.
  assert.deepEqual(
    lines(TitleCell({ ...base, file: movie(), instance: "Radarr 4K" }))[1],
    [
      "v2-table-sub",
      "Radarr 4K · Arrival.2016.2160p.mkv",
      "Radarr 4K · Arrival.2016.2160p.mkv",
    ],
  );
  // An episode sorted by another column: series and number, then the
  // episode title and the filename; two episodes in one file.
  const twin = episode(2, 1, 2, {
    episodes: [
      { id: 1, number: 2, title: "Lies", year: 2017 },
      { id: 2, number: 3, title: "Past and Present", year: 2017 },
    ],
    title: "Lies",
  });
  assert.deepEqual(
    lines(
      TitleCell({
        ...base,
        service: "sonarr",
        sort: { field: "year", direction: "desc" },
        file: twin,
      }),
    ),
    [
      ["v2-table-line", "Dark · S01E02–03", "Dark · S01E02–03", "TitleMarks"],
      ["v2-table-sub", "Lies · Dark.S01E02.mkv", "Lies · Dark.S01E02.mkv"],
    ],
  );
  // In the title order (season groups) the episode title, then the file;
  // a season context row says so first in its sub-line, so it keeps the
  // row height.
  assert.deepEqual(
    lines(
      TitleCell({
        ...base,
        service: "sonarr",
        file: episode(3, 1, 3, { matched: false }),
      }),
    ),
    [
      ["v2-table-line", "Episode 3", "Episode 3", "TitleMarks"],
      [
        "v2-table-sub",
        "Season context · not a filter match · Dark.S01E03.mkv",
        "Season context · not a filter match · Dark.S01E03.mkv",
      ],
    ],
  );
  // The marks get the file, its job and the actions.
  const opened = [];
  const job = { service: "radarr", fileId: 1, status: "ready" };
  const marks = kids(
    kids(
      TitleCell({
        ...base,
        file: movie(),
        muxJob: job,
        openMux: () => opened.push("mux"),
        openDetails: () => opened.push("details"),
      }),
    )[0],
  )[1];
  assert.equal(marks.props.file.title, "Arrival");
  assert.equal(marks.props.settings, base.settings);
  assert.equal(marks.props.muxJob, job);
  marks.props.openMux();
  marks.props.openDetails();
  assert.deepEqual(opened, ["mux", "details"]);

  // The table names the instance only when the service has more than one,
  // the file's own name first; it finds the file's mux job.
  const titleOf = (fields, file) =>
    kids(
      cells(
        bodyRows(
          MediaTable(
            tableProps({ columns: ["title"], files: [file], ...fields }),
          ),
        )[0],
      )[1],
    )[0];
  assert.equal(titleOf({}, movie()).props.instance, undefined);
  const two = settings({
    instances: [
      instance("radarr", "radarr", { name: "Radarr HD" }),
      instance("radarr-2", "radarr", { name: "Radarr 4K" }),
      instance("sonarr", "sonarr"),
    ],
  });
  assert.equal(
    titleOf({ settings: two }, movie({ service: "radarr-2" })).props.instance,
    "Radarr 4K",
  );
  assert.equal(
    titleOf({ settings: two }, movie({ instanceName: "Cinema" })).props
      .instance,
    "Cinema",
  );
  const jobs = [
    { service: "radarr", fileId: 2, status: "ready" },
    { service: "radarr", fileId: 1, status: "running" },
  ];
  const cell = titleOf({ muxJobs: jobs }, movie());
  assert.equal(cell.props.muxJob, jobs[1]);
  assert.equal(cell.props.sort.field, "title");
  assert.equal(cell.props.service, "radarr");
});

test("info buttons and title marks follow the settings", () => {
  const { InfoButtons, TitleMarks } = modules();
  const opened = [];
  const props = (fields = {}) => ({
    file: movie(),
    settings: settings(),
    openDetails: () => opened.push("details"),
    ...fields,
  });
  const shown = (tree) =>
    kids(tree).map((n) => [n.type, n.props.label ?? n.type]);
  // The Info column: link, media and details in the saved order.
  let tree = InfoButtons(props());
  assert.equal(tree.props.class, "v2-table-items");
  assert.deepEqual(shown(tree), [
    ["RowButton", "Open Radarr entry in a new tab"],
    ["MediaLinkButton", "MediaLinkButton"],
    ["RowButton", "Filename and metadata: Arrival"],
  ]);
  // The entry link is locked with its hint while the service gives no
  // address; with a title slug it opens a new tab.
  const [link, media, details] = kids(tree);
  assert.deepEqual(data(link.props), {
    label: "Open Radarr entry in a new tab",
    title:
      "Entry link unavailable. Configure the service and synchronize the library.",
    icon: data(link.props.icon),
    newTab: true,
    disabled: true,
  });
  assert.equal(link.props.icon.props.size, 15);
  const [slugged] = kids(
    InfoButtons(props({ file: movie({ titleSlug: "arrival-2016" }) })),
  );
  assert.equal(slugged.props.href, "http://radarr.local/movie/arrival-2016");
  assert.equal(slugged.props.disabled, false);
  assert.equal(slugged.props.title, undefined);
  assert.equal(media.props.file.title, "Arrival");
  // File & metadata: its title is the filename.
  assert.equal(details.props.title, "Arrival.2016.2160p.mkv");
  details.props.onClick();
  assert.deepEqual(opened, ["details"]);
  // A hidden key is missing, the order is the user's.
  tree = InfoButtons(
    props({
      settings: settings({
        listInfoOrder: ["mux", "details", "metadata", "link", "media"],
        listInfoVisible: ["details", "link", "mux"],
      }),
    }),
  );
  assert.deepEqual(shown(tree), [
    ["RowButton", "Filename and metadata: Arrival"],
    ["RowButton", "Open Radarr entry in a new tab"],
  ]);
  // Without settings every key shows in the 1.7.0 order.
  assert.equal(kids(InfoButtons(props({ settings: null }))).length, 3);

  // The title marks: metadata and recognition in the user's warning
  // colors, the mux mark only with a job, then the outliers.
  const marks = (fields) =>
    kids(
      TitleMarks({
        file: movie({
          conflict: true,
          ruleConflict: true,
          seasonOutlier: true,
          languageOutlier: true,
        }),
        settings: settings(),
        muxJob: { service: "radarr", fileId: 1, status: "needs_review" },
        openMux: () => opened.push("mux"),
        openDetails: () => opened.push("details"),
        ...fields,
      }),
    );
  const summary = (list) =>
    list.map((n) => [
      n.props.tone,
      n.props.label,
      n.props.title,
      n.props.color,
      typeof n.props.onClick,
    ]);
  let list = marks();
  assert.ok(list.every((n) => n.type === "RowMark"));
  assert.deepEqual(summary(list), [
    [
      "warn",
      "Show conflicting metadata",
      "Metadata disagreement",
      "#e0a020",
      "function",
    ],
    [
      "warn",
      "Show recognition conflicts",
      "Conflicting recognition rules",
      "#a080f0",
      "function",
    ],
    [
      "accent",
      "Marked for muxing · Review needed",
      undefined,
      undefined,
      "function",
    ],
    [
      "info",
      "Technical outliers · Language outliers",
      undefined,
      undefined,
      "undefined",
    ],
  ]);
  assert.ok(list.every((n) => n.props.icon.props.size === 13));
  opened.length = 0;
  list[0].props.onClick();
  list[1].props.onClick();
  list[2].props.onClick();
  assert.deepEqual(opened, ["details", "details", "mux"]);
  // The user's order and visibility; without a job no mux mark; the
  // 1.7.0 default colors without settings.
  list = marks({
    settings: settings({
      listInfoOrder: ["recognition", "link", "mux", "metadata"],
      listInfoVisible: ["recognition", "metadata", "link"],
    }),
  });
  assert.deepEqual(
    list.map((n) => n.props.label),
    [
      "Show recognition conflicts",
      "Show conflicting metadata",
      "Technical outliers · Language outliers",
    ],
  );
  list = marks({ settings: null, muxJob: undefined });
  assert.deepEqual(
    summary(list)
      .slice(0, 2)
      .map((m) => m[3]),
    ["#d9a870", "#b994f0"],
  );
  assert.equal(list.length, 3);
  // Without conflicts or outliers there is no mark.
  assert.deepEqual(
    kids(
      TitleMarks({
        file: movie(),
        settings: settings(),
        openMux() {},
        openDetails() {},
      }),
    ),
    [],
  );
  assert.deepEqual(
    marks({
      file: movie({ languageOutlier: true }),
      muxJob: undefined,
    }).map((n) => n.props.label),
    ["Language outliers"],
  );
});

test("the media server button links one server and lists several", () => {
  const { MediaLinkButton } = modules();
  const servers = (...list) =>
    settings({
      instances: [instance("radarr", "radarr"), ...list],
    });
  const linked = { status: "matched", link: { itemId: "a1", serverId: "s1" } };
  const file = movie({ mediaServers: { emby: linked, jellyfin: linked } });
  const view = (s, f = file) =>
    mount(MediaLinkButton, { file: f, settings: s });
  // No media server: nothing.
  assert.equal(view(servers()).render(), null);
  // One linked server: a link into a new tab.
  let node = view(
    servers(instance("emby", "emby", { url: "http://emby.local/" })),
  ).render();
  assert.equal(node.type, "RowButton");
  assert.equal(node.props.label, "Open media server entry in a new tab");
  assert.equal(node.props.title, "Open Emby entry in a new tab");
  assert.equal(
    node.props.href,
    "http://emby.local/web/index.html#!/item?id=a1&serverId=s1",
  );
  assert.equal(node.props.newTab, true);
  assert.equal(node.props.icon.props.size, 15);
  // Without a mapped entry it is locked with its hint.
  const hint =
    "Media server link unavailable. Synchronize the library and check the file mapping.";
  node = view(
    servers(instance("emby", "emby"), instance("jellyfin", "jellyfin")),
    movie(),
  ).render();
  assert.equal(node.type, "RowButton");
  assert.equal(node.props.disabled, true);
  assert.equal(node.props.title, hint);
  assert.equal(node.props.label, "Open media server entry in a new tab");
  // Several servers: a menu "Choose media server" of their links; one
  // without an entry stays a disabled entry with the hint.
  const two = view(
    servers(
      instance("emby", "emby", { name: "Living room" }),
      instance("jellyfin", "jellyfin"),
    ),
    movie({ mediaServers: { emby: linked } }),
  );
  let tree = two.render();
  const trigger = ofType(tree, "RowButton")[0];
  assert.equal(trigger.props.label, "Choose media server");
  assert.equal(trigger.props.popup, "menu");
  assert.equal(trigger.props.expanded, false);
  assert.equal(ofType(tree, "Popover").length, 0);
  let focused = 0;
  const anchor = { focus: () => focused++ };
  trigger.props.onClick({ currentTarget: anchor });
  tree = two.render();
  assert.equal(ofType(tree, "RowButton")[0].props.expanded, true);
  const [menu] = ofType(tree, "Popover");
  assert.equal(menu.props.anchor, anchor);
  assert.equal(menu.props.role, "menu");
  assert.equal(menu.props.label, "Choose media server");
  const entries = kids(menu);
  assert.deepEqual(
    entries.map((entry) =>
      data({ type: entry.type, ...entry.props, children: text(entry) }),
    ),
    [
      {
        type: "a",
        role: "menuitem",
        class: "v2-menu-item",
        href: "http://emby.local/web/index.html#!/item?id=a1&serverId=s1",
        target: "_blank",
        rel: "noopener noreferrer",
        referrerPolicy: "no-referrer",
        children: "Living room",
      },
      {
        type: "span",
        role: "menuitem",
        class: "v2-menu-item",
        "aria-disabled": "true",
        title: hint,
        children: "Jellyfin",
      },
    ],
  );
  // A choice returns focus to the button and closes the menu.
  entries[0].props.onClick();
  assert.equal(focused, 1);
  tree = two.render();
  assert.equal(ofType(tree, "Popover").length, 0);
  // A second press closes it as well; closing by the popover too.
  ofType(tree, "RowButton")[0].props.onClick({ currentTarget: anchor });
  tree = two.render();
  ofType(tree, "RowButton")[0].props.onClick({ currentTarget: anchor });
  assert.equal(ofType(two.render(), "Popover").length, 0);
  ofType(two.render(), "RowButton")[0].props.onClick({ currentTarget: anchor });
  ofType(two.render(), "Popover")[0].props.close(true);
  assert.equal(ofType(two.render(), "Popover").length, 0);
});

test("selection boxes keep their groups", () => {
  const files = [
    episode(1, 1, 1),
    episode(2, 1, 2, { seasonOutlier: true }),
    episode(3, 2, 1),
    episode(4, 0, 1),
  ];
  const key = (f) => ({
    service: f.service,
    id: f.id,
    mediaId: f.mediaId,
    season: f.season,
    filename: f.filename,
    title: f.title,
  });
  const chosen = selection({
    selected: { "sonarr:1": key(files[0]) },
    keys: [key(files[0])],
  });
  const props = tableProps({
    service: "sonarr",
    files,
    columns: ["title", "year"],
    selection: chosen,
  });
  const boxOf = (cell) => {
    assert.equal(cell.props.class, "v2-table-sel");
    const [hit] = kids(cell);
    assert.equal(hit.type, "label");
    assert.equal(hit.props.class, "v2-table-hit");
    const [box] = kids(hit);
    assert.equal(box.type, "SelectionBox");
    assert.equal(box.props.className, "v2-check");
    return box;
  };
  const describe = (box) => [
    box.props.label,
    box.props.total,
    box.props.count,
    box.props.disabled,
  ];
  let tree = modules().MediaTable(props);
  // The page: tri-state over the visible files.
  const page = boxOf(cells(head(tree))[0]);
  assert.deepEqual(describe(page), ["Select this page", 4, 1, false]);
  page.props.change(true);
  assert.deepEqual(chosen.calls.pop(), ["toggle", files.map(key), true]);
  // Series, seasons (Specials for 0) and files in the title order.
  const rows = bodyRows(tree);
  assert.deepEqual(
    rows.map((row) => [row.props.class, describe(boxOf(cells(row)[0]))]),
    [
      ["v2-row--series", ["Select series Dark", 4, 1, false]],
      [
        "v2-row--season v2-row--outlier",
        ["Select season 1 of Dark", 2, 1, false],
      ],
      ["v2-row v2-row--selected", ["Select Episode 1", 1, 1, false]],
      ["v2-row", ["Select Episode 2", 1, 0, false]],
      ["v2-row--season", ["Select season 2 of Dark", 1, 0, false]],
      ["v2-row", ["Select Episode 3", 1, 0, false]],
      ["v2-row--season", ["Select season 0 of Dark", 1, 0, false]],
      ["v2-row", ["Select Episode 4", 1, 0, false]],
    ],
  );
  // A group box selects its group, a row box its file.
  boxOf(cells(rows[0])[0]).props.change(true);
  boxOf(cells(rows[1])[0]).props.change(false);
  boxOf(cells(rows[3])[0]).props.change(true);
  assert.deepEqual(chosen.calls, [
    ["group", "sonarr", 21, undefined, true],
    ["group", "sonarr", 21, 1, false],
    ["toggle", [key(files[1])], true],
  ]);
  // The group rows span the columns: the series with its counts, a season
  // with its name and the season mode.
  const label = (row) => {
    const [, cell] = cells(row);
    assert.equal(cell.props.colSpan, 2);
    assert.equal(cell.props.role, "cell");
    return text(cell);
  };
  assert.equal(label(rows[0]), "Dark4 episodes · 3 seasons");
  assert.equal(label(rows[1]), "Season 01Matching files");
  assert.equal(label(rows[6]), "SpecialsMatching files");
  assert.equal(
    ofType(cells(rows[1])[1], "span")[0].props.class,
    "v2-table-name",
  );
  tree = modules().MediaTable({
    ...props,
    settings: settings({ seasonMode: "season" }),
  });
  assert.equal(label(bodyRows(tree)[1]), "Season 01Season context enabled");
  // While a selection action runs every box is locked.
  tree = modules().MediaTable({
    ...props,
    selection: { ...chosen, busy: true },
  });
  const all = byClass(tree, "v2-table-sel").map(boxOf);
  assert.equal(all.length, 9);
  assert.ok(all.every((box) => box.props.disabled === true));
  // Another sort has no group rows; movies never have them.
  tree = modules().MediaTable({
    ...props,
    sort: { field: "year", direction: "asc" },
  });
  assert.deepEqual(
    bodyRows(tree).map((row) => row.props.class),
    ["v2-row v2-row--selected", "v2-row", "v2-row", "v2-row"],
  );
  tree = modules().MediaTable(
    tableProps({ files: [movie(), movie({ id: 2 })] }),
  );
  assert.equal(bodyRows(tree).length, 2);
});

test("rows carry their conflict, incomplete and outlier marks", () => {
  const files = [
    movie({ id: 1 }),
    movie({ id: 2, conflict: true }),
    movie({ id: 3, ruleConflict: true, metadataIncomplete: true }),
    movie({ id: 4, metadataIncomplete: true }),
    movie({ id: 5, matched: false }),
  ];
  const tree = table({ files });
  assert.deepEqual(
    bodyRows(tree).map((row) => row.props.class),
    [
      "v2-row",
      "v2-row v2-row--warn",
      "v2-row v2-row--warn",
      "v2-row v2-row--info",
      "v2-row v2-row--context",
    ],
  );
  // Each file's rows are keyed by its file key ("service:id"), so an
  // instance "radarr2" with file 3 never meets "radarr" with file 23.
  assert.deepEqual(
    kids(ofType(tree, "tbody")[0]).map((node) => node.key),
    ["radarr:1", "radarr:2", "radarr:3", "radarr:4", "radarr:5"],
  );
  const twins = table({
    files: [
      movie({ service: "radarr2", id: 3 }),
      movie({ service: "radarr", id: 23 }),
    ],
  });
  assert.deepEqual(
    kids(ofType(twins, "tbody")[0]).map((node) => node.key),
    ["radarr2:3", "radarr:23"],
  );
  // Each file row keeps its information-only values for its tags.
  const providers = kids(ofType(tree, "tbody")[0]).flatMap((node) =>
    nodes(node).filter((n) => n.type === ui.TagInformation.Provider),
  );
  assert.equal(providers.length, 5);
  assert.deepEqual(data(providers[0].props.value), { source: ["WEB-DL"] });
  const bare = table({ files: [movie({ informationOnly: undefined })] });
  const [provider] = nodes(bare).filter(
    (n) => n.type === ui.TagInformation.Provider,
  );
  assert.deepEqual(data(provider.props.value), {});
  // Outliers mark the title (TitleMarks) and their season row.
  const { TitleCell } = modules({ real: ["TitleMarks"] });
  const line = kids(
    TitleCell({
      file: movie({ seasonOutlier: true }),
      service: "radarr",
      sort: { field: "title", direction: "asc" },
      settings: settings(),
      openMux() {},
      openDetails() {},
    }),
  )[0];
  const marks = kids(line)[1];
  assert.equal(marks.type.name, "TitleMarks");
  const [mark] = nodes(marks.type(marks.props)).filter(
    (n) => n.type === "RowMark",
  );
  assert.equal(mark.props.tone, "info");
  assert.equal(mark.props.label, "Technical outliers");
});

test("placeholder rows hide from assistive technology", () => {
  const tree = table({ files: [], placeholders: 3 });
  const rows = bodyRows(tree);
  assert.equal(rows.length, 3);
  for (const row of rows) {
    assert.equal(row.props.class, "v2-row--placeholder");
    assert.equal(row.props["aria-hidden"], "true");
    // The cells of a file row (so a narrow card wraps them into the same
    // lines), each a no-break space; the title has its two lines.
    assert.deepEqual(
      cells(row).map((cell) => [
        cell.props.class ?? "",
        cell.props.colSpan,
        cell.props.role,
        cell.props["data-label"],
      ]),
      [
        ["v2-table-sel", undefined, undefined, undefined],
        ["v2-table-info", undefined, undefined, undefined],
        ["v2-table-title", undefined, undefined, undefined],
        ["v2-table-num", undefined, undefined, undefined],
        ["", undefined, undefined, undefined],
      ],
    );
    assert.deepEqual(
      cells(row).map((cell) => [
        text(cell),
        ofType(cell, "div").map((line) => [line.props.class, text(line)]),
      ]),
      [
        ["\u00a0", []],
        ["\u00a0", []],
        [
          "\u00a0\u00a0",
          [
            ["v2-table-name", "\u00a0"],
            ["v2-table-sub", "\u00a0"],
          ],
        ],
        ["\u00a0", []],
        ["\u00a0", []],
      ],
    );
  }
  // The page box has nothing to select yet.
  const [box] = kids(kids(cells(head(tree))[0])[0]);
  assert.equal(box.props.total, 0);
  assert.equal(bodyRows(table({ placeholders: 0 })).length, 1);
});

test("cells name their column for narrow cards", () => {
  const columns = ["info", "title", "year", "size", "bitDepth", "audio"];
  const tree = table({ columns, service: "radarr" });
  // Explicit roles keep the table semantics when the rows turn into cards.
  assert.equal(tree.props.role, "table");
  for (const group of [ofType(tree, "thead")[0], ofType(tree, "tbody")[0]])
    assert.equal(group.props.role, "rowgroup");
  assert.equal(head(tree).props.role, "row");
  assert.equal(cells(head(tree))[0].props.role, "columnheader");
  const [row] = bodyRows(tree);
  assert.equal(row.props.role, "row");
  const [sel, ...tds] = cells(row);
  assert.equal(sel.props.role, "cell");
  assert.deepEqual(
    tds.map((td) => [td.props.role, td.props["data-label"]]),
    [
      ["cell", "Info"],
      ["cell", "Title"],
      ["cell", "Year"],
      ["cell", "Size"],
      ["cell", "Bit depth"],
      ["cell", "Audio tracks"],
    ],
  );
  // The sort header of a column is a columnheader as well; the title one
  // grows.
  const { SortHeader } = loadSource("components/list/SortHeader.tsx", {
    modules: {
      "preact/hooks": hooks,
      "../../ui": ui,
      "../../i18n": i18n,
      "../frame/Popover": { Popover: "Popover" },
    },
  });
  const sort = { field: "title", direction: "asc" };
  const th = once(SortHeader, {
    label: "Title",
    field: "title",
    sort,
    onSort() {},
    grow: true,
  });
  assert.equal(th.props.role, "columnheader");
  assert.equal(th.props.class, "v2-table-title");
  assert.equal(
    once(SortHeader, {
      label: "Year",
      field: "year",
      sort,
      onSort() {},
      numeric: true,
    }).props.class,
    "v2-table-num",
  );
});

// --- CustomTagsCell ----------------------------------------------------------

test("custom tags show two and name the rest", () => {
  const { CustomTagsCell } = modules();
  const tags = [
    { id: 1, name: "kids" },
    { id: 2, name: "archive", displayName: "Archive" },
    { id: 3, name: "hidden" },
    { id: 4, name: "4k" },
    { id: 5, name: "remux", displayName: "Remux" },
  ];
  const contexts = (hidden = {}, names = {}) =>
    new Map([
      [ui.HiddenTags, hidden],
      [ui.CustomTagNames, names],
    ]);
  const edited = [];
  const props = {
    file: movie({ custom: tags }),
    settings: settings(),
    edit: () => edited.push("edit"),
  };
  let tree = once(
    CustomTagsCell,
    props,
    contexts({ "custom:3": true }, { 4: "UHD" }),
  );
  assert.equal(tree.props.class, "v2-table-items");
  const [button, first, second, more] = kids(tree);
  assert.equal(kids(tree).length, 4);
  assert.equal(button.type, "RowButton");
  assert.equal(button.props.label, "Edit custom tags: Arrival");
  assert.equal(button.props.size, "sm");
  assert.equal(button.props.icon.props.size, 13);
  button.props.onClick();
  assert.deepEqual(edited, ["edit"]);
  assert.deepEqual(
    [first, second].map((n) => [n.type, n.props.tag.id, n.props.settings]),
    [
      ["CustomTag", 1, props.settings],
      ["CustomTag", 2, props.settings],
    ],
  );
  // +n reads "+2", its name and title the other names as the tags read
  // them, display name else name (the hidden tag is not counted; a custom
  // tag name of the tag contexts does not apply, as on CustomTag).
  assert.equal(more.type, "span");
  assert.equal(more.props.class, "v2-ctag");
  assert.equal(more.props.title, "4k, Remux");
  const [visible, spoken] = kids(more);
  assert.equal(visible.props["aria-hidden"], "true");
  assert.equal(text(visible), "+2");
  assert.equal(spoken.props.class, "v2-sr-only");
  assert.equal(text(spoken), "4k, Remux");
  // Two tags or fewer: no +n; none: only the edit button.
  tree = once(
    CustomTagsCell,
    { ...props, file: movie({ custom: tags.slice(0, 2) }) },
    contexts(),
  );
  assert.deepEqual(
    kids(tree).map((n) => n.type),
    ["RowButton", "CustomTag", "CustomTag"],
  );
  tree = once(CustomTagsCell, { ...props, file: movie() }, contexts());
  assert.deepEqual(
    kids(tree).map((n) => n.type),
    ["RowButton"],
  );
});

// --- 1.7.0 counterparts ----------------------------------------------------------

test("the 1.7.0 selection box keeps its markup without a class", () => {
  const { SelectionBox } = loadSource("components/SelectionBox.tsx");
  const box = SelectionBox({
    count: 0,
    total: 2,
    label: "Select",
    change() {},
  });
  assert.equal(box.props.class, undefined);
  assert.equal(
    SelectionBox({
      count: 1,
      total: 2,
      label: "Select",
      change() {},
      className: "v2-check",
    }).props.class,
    "v2-check",
  );
  // A row mark's title is its label unless given.
  const { RowMark } = loadSource("components/list/RowMark.tsx", {
    modules: { "../../nav-link": { followLink() {} } },
  });
  const mark = RowMark({
    tone: "warn",
    label: "Show",
    icon: "i",
    onClick() {},
  });
  assert.equal(mark.props.title, "Show");
  assert.equal(
    RowMark({ tone: "warn", label: "Show", title: "Why", icon: "i" }).props
      .title,
    "Why",
  );
});

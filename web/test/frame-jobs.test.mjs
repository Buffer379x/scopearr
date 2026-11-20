import test from "node:test";
import assert from "node:assert/strict";
import * as icons from "lucide-preact";
import {
  componentHarness,
  loadSource,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { createHookRuntime } from "./helpers/hook-runtime.mjs";

// The bell's jobs menu (Task 12, E17 with ruling R-B): the counts come from
// the status (frame-status.jobsSummary), each tool with open jobs is a row
// that links to its page, its jobs load only when the menu opens
// (hooks/useOpenJobs.ts) and show under it, and failures lead to the
// filtered log (components/frame/JobsMenu.tsx).

// Values cross a VM realm; compare their JSON shape.
const plain = (value) => JSON.parse(JSON.stringify(value));
const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

const storage = loadSource("browser-storage.ts");
const toolRoute = loadSource("tool-route.ts", {
  modules: { "./browser-storage": storage },
});
const instances = loadSource("instances.ts");
const toolTable = loadSource("tool-table.ts");
const frameStatus = loadSource("frame-status.ts", {
  modules: {
    "./instances": instances,
    "./tool-route": toolRoute,
    "./tool-table": toolTable,
    "./mux-spec": loadSource("mux-spec.ts", {
      modules: { "./languages.ts": { audioLanguage: () => "" } },
    }),
    "./placement": loadSource("placement.ts"),
    "./filecheck": loadSource("filecheck.ts"),
  },
});
const router = loadSource("router.ts", {
  modules: {
    "./event-log": loadSource("event-log.ts"),
    "./tool-route": toolRoute,
  },
});
const navModel = loadSource("nav-model.ts", {
  modules: {
    "./instances": instances,
    "./frame-status": frameStatus,
    "./router": router,
    "./tool-route": toolRoute,
  },
});

// Every tool visible, without open jobs unless given.
const statusWith = ({ mux = {}, unraid = {}, files = {} } = {}) => ({
  demo: false,
  mux: {
    enabled: true,
    installed: true,
    pending: 0,
    running: 0,
    failed: 0,
    ...mux,
  },
  unraid: { enabled: true, pending: 0, running: 0, failed: 0, ...unraid },
  files: { available: true, pending: 0, running: 0, failed: 0, ...files },
});

const ui = { ICON: { sort: 13, label: 15, button: 16 }, count: String };
const classes = (node) => String(node?.props?.class ?? "").split(/\s+/);
const hasClass = (node, name) => classes(node).includes(name);
const byClass = (tree, name) => nodes(tree).filter((n) => hasClass(n, name));
const hrefOf = (target) => "#/" + JSON.stringify(target);

// The jobs menu with the jobs useOpenJobs hands it (none loaded yet unless
// given); `asked` records the tools it was asked to load.
function menu(status, { jobs = {}, ...overrides } = {}) {
  const calls = [],
    asked = [];
  const props = {
    summary: frameStatus.jobsSummary(status),
    hrefOf,
    open: (target) => calls.push(["open", plain(target)]),
    showLog: (sources) => calls.push(["showLog", plain(sources)]),
    close: (returnFocus) => calls.push(["close", returnFocus]),
    anchor: { name: "bell", focus: () => calls.push(["focus", "bell"]) },
    ...overrides,
  };
  const tree = componentHarness("frame/JobsMenu", props, {
    exportName: "JobsMenu",
    modules: {
      "../../i18n": { t },
      "../../ui": ui,
      "../../frame-status": frameStatus,
      "../../nav-model": navModel,
      "../../hooks/useOpenJobs": {
        useOpenJobs: (tools) => {
          asked.push(plain(tools).map((tool) => tool.view));
          return jobs;
        },
      },
      "./Popover": { Popover: "Popover" },
      "./Sidebar": {
        NAV_ICONS: {
          mux: icons.Scissors,
          disks: icons.HardDrive,
          files: icons.FolderCheck,
        },
      },
    },
  }).render();
  return { tree, calls, asked, props };
}
// A tool row: its link, its name, its counts line, its jobs and the
// placeholder rows that hold their place while they load.
const placeholder = (job) => job.props["aria-hidden"] === "true";
const rows = (tree) =>
  nodes(byClass(tree, "v2-jobs")[0])
    .filter((n) => n.type === "li" && !hasClass(n, "v2-job"))
    .map((item) => {
      const link = nodes(item).find((n) => n.type === "NavLink");
      const entries = byClass(item, "v2-job");
      return {
        link,
        name: text(byClass(link, "v2-jobs-name")[0]),
        line: text(byClass(link, "v2-jobs-line")[0]),
        jobs: entries
          .filter((job) => !placeholder(job))
          .map((job) => [
            classes(byClass(job, "v2-dot")[0]).join(" "),
            text(byClass(job, "v2-jobs-name")[0]),
            text(byClass(job, "v2-jobs-line")[0]),
          ]),
        placeholders: entries.filter(placeholder),
      };
    });
// "Running 1 · Waiting 2" → 3.
const numbers = (line) =>
  [...line.matchAll(/\d+/g)].reduce((sum, [n]) => sum + Number(n), 0);

test("the bell counts what the tools badge counted", () => {
  const cases = [
    // Disk placement is visible without open jobs: no row (only tools with
    // open jobs have one).
    statusWith({
      mux: { pending: 2, running: 1 },
      files: { pending: 1, failed: 1 },
    }),
    // With open jobs it has its row, between the others, as in TOOLS.
    statusWith({
      mux: { pending: 2, running: 1 },
      unraid: { running: 1, pending: 4 },
      files: { pending: 1, failed: 1 },
    }),
    // A hidden tool counts nowhere and has no row.
    {
      ...statusWith({ mux: { failed: 3 }, files: { running: 2 } }),
      unraid: { enabled: false, pending: 5, running: 1, failed: 2 },
    },
  ];
  const expected = [
    [
      ["Muxing", "Running 1 · Waiting 2"],
      ["Files & permissions", "Waiting 1 · Failed 1"],
    ],
    [
      ["Muxing", "Running 1 · Waiting 2"],
      ["Disk placement", "Running 1 · Waiting 4"],
      ["Files & permissions", "Waiting 1 · Failed 1"],
    ],
    [
      ["Muxing", "Failed 3"],
      ["Files & permissions", "Running 2"],
    ],
  ];
  for (const [index, status] of cases.entries()) {
    // The 1.7.0 Tools badge: openJobCount of every visible tool.
    const badge = [
      [status.mux, status.mux.enabled],
      [status.unraid, status.unraid.enabled],
      [status.files, status.files.available],
    ].reduce(
      (sum, [jobs, visible]) =>
        sum + (visible ? toolTable.openJobCount(jobs) : 0),
      0,
    );
    const summary = frameStatus.jobsSummary(status);
    assert.equal(summary.count, badge, "the bell's count");
    assert.equal(
      navModel.tabBarModel({
        route: router.parseRoute("#/dashboard"),
        settings: null,
        status,
        translate: (key) => key,
      }).toolsBadge,
      badge,
      "the tab bar's Tools plaque",
    );
    // One row per tool with open jobs; their numbers add up to the bell.
    const { tree, calls, asked } = menu(status);
    const shown = rows(tree);
    assert.deepEqual(
      shown.map((row) => [row.name, row.line]),
      expected[index],
    );
    assert.equal(
      shown.reduce((sum, row) => sum + numbers(row.line), 0),
      badge,
    );
    // The jobs are asked for exactly these tools.
    const views = plain(summary.tools)
      .filter((tool) => tool.open > 0)
      .map((tool) => tool.view);
    assert.deepEqual(asked, [views]);
    // Each row is a frame link to its tool page with a decorative tile.
    for (const [n, row] of shown.entries()) {
      const target = { view: views[n] };
      assert.equal(row.link.props.href, hrefOf(target));
      assert.ok(hasClass(row.link, "v2-menu-item"));
      assert.ok(hasClass(row.link, "v2-menu-item--tile"));
      const tile = byClass(row.link, "v2-tile")[0];
      assert.equal(tile.props["aria-hidden"], "true");
      // Focus returns to the bell first (final review M1), as from the
      // drawer to More.
      row.link.props.open();
      assert.deepEqual(calls.slice(-2), [
        ["focus", "bell"],
        ["open", target],
      ]);
    }
  }
});

test("failures turn the plaque to the error tone and lead to the filtered log", () => {
  const failing = statusWith({
    mux: { failed: 1, pending: 1 },
    unraid: { pending: 2 },
    files: { failed: 2 },
  });
  const summary = frameStatus.jobsSummary(failing);
  // The bell's plaque in the error tone (Topbar).
  const topbar = componentHarness(
    "frame/Topbar",
    {
      mode: "rail",
      crumbs: ["Scopearr", "Dashboard"],
      title: "Dashboard",
      scrolled: true,
      demo: false,
      sync: null,
      jobs: summary,
      theme: "dark",
      homeHref: "#/dashboard",
      openHome() {},
      toggleTheme() {},
      signOut() {},
      onJobs() {},
    },
    { exportName: "Topbar", modules: { "../../i18n": { t }, "../../ui": ui } },
  ).render();
  const bell = nodes(topbar).find((n) => hasClass(n, "v2-bell"));
  const plaque = byClass(bell, "v2-plaque")[0];
  assert.equal(text(plaque), "6");
  assert.ok(hasClass(plaque, "v2-plaque--error"));

  // The menu's footer leads to the log of the failed tools' sources.
  const { tree, calls } = menu(failing);
  const foot = byClass(tree, "v2-pop-foot");
  assert.equal(foot.length, 1);
  const buttons = nodes(foot[0]).filter((n) => n.type === "button");
  assert.deepEqual(
    buttons.map((button) => text(button)),
    ["Show in log"],
  );
  assert.equal(buttons[0].props.type, "button");
  assert.ok(
    hasClass(buttons[0], "v2-btn") && hasClass(buttons[0], "v2-btn--sm"),
  );
  buttons[0].props.onClick();
  assert.deepEqual(calls, [
    ["focus", "bell"],
    ["showLog", ["mux", "filecheck"]],
  ]);
  // The log sources of the tools (event-log.ts): Disk placement logs as
  // "placement", Files & permissions as "filecheck".
  assert.deepEqual(plain(frameStatus.logSources(summary)), [
    "mux",
    "filecheck",
  ]);
  assert.deepEqual(
    plain(
      frameStatus.logSources(
        frameStatus.jobsSummary(statusWith({ unraid: { failed: 1 } })),
      ),
    ),
    ["placement"],
  );
  const { eventSources } = loadSource("event-log.ts");
  for (const source of ["mux", "placement", "filecheck"])
    assert.ok(Object.hasOwn(eventSources, source), source);

  // Without a failure: no footer and no error tone.
  const calm = statusWith({ mux: { running: 1 }, files: { pending: 2 } });
  assert.equal(byClass(menu(calm).tree, "v2-pop-foot").length, 0);
  assert.deepEqual(
    plain(frameStatus.logSources(frameStatus.jobsSummary(calm))),
    [],
  );
});

test("an empty bell says so", () => {
  for (const status of [
    statusWith(),
    // No visible tool at all.
    { demo: true, mux: { enabled: false }, unraid: { enabled: false } },
  ]) {
    const { tree, asked } = menu(status);
    // A dialog named "Jobs" with its header and the one sentence.
    const pop = nodes(tree).find((n) => n.type === "Popover");
    assert.equal(pop.props.role, "dialog");
    assert.equal(pop.props.label, "Jobs");
    assert.deepEqual(
      byClass(tree, "v2-pop-title").map((title) => text(title)),
      ["Jobs"],
    );
    assert.deepEqual(
      byClass(tree, "v2-pop-text").map((note) => text(note)),
      ["No open jobs."],
    );
    // No list, no footer, nothing to load.
    assert.equal(byClass(tree, "v2-jobs").length, 0);
    assert.equal(byClass(tree, "v2-pop-foot").length, 0);
    assert.equal(nodes(tree).filter((n) => n.type === "NavLink").length, 0);
    assert.deepEqual(asked, [[]]);
  }
});

test("each open job shows under its tool once it loads", () => {
  const status = statusWith({
    mux: { running: 1, pending: 1, failed: 1 },
    files: { pending: 2 },
  });
  const anchor = { name: "bell" };
  // Before the jobs arrive (and for a tool whose jobs could not be loaded)
  // the tool's row stands alone (E17).
  const before = menu(status, { anchor });
  assert.deepEqual(
    rows(before.tree).map((row) => row.jobs),
    [[], []],
  );
  // The one popover primitive at the bell: a wide dialog, closed through
  // the owner's close.
  const pop = nodes(before.tree).find((n) => n.type === "Popover");
  assert.equal(pop.props.anchor, anchor);
  assert.equal(pop.props.placement, "bottom-end");
  assert.equal(pop.props.wide, true);
  pop.props.close(true);
  assert.deepEqual(before.calls, [["close", true]]);

  // Loaded: each job with its state dot (decorative), its name and its
  // state with its file; Files & permissions failed to load.
  const loaded = menu(status, {
    jobs: {
      mux: [
        {
          id: 7,
          name: "Arrival",
          detail: "Arrival (2016).mkv",
          state: "running",
        },
        { id: 3, name: "Heat", detail: "Heat (1995).mkv", state: "failed" },
        { id: 9, name: "Dune", detail: "", state: "waiting" },
      ],
      files: null,
    },
  });
  const shown = rows(loaded.tree);
  assert.deepEqual(shown[0].jobs, [
    ["v2-dot v2-dot--running", "Arrival", "Running · Arrival (2016).mkv"],
    ["v2-dot v2-dot--error", "Heat", "Failed · Heat (1995).mkv"],
    ["v2-dot v2-dot--off", "Dune", "Waiting"],
  ]);
  assert.deepEqual(shown[1].jobs, []);
  // Loaded or failed, no placeholder is left.
  assert.deepEqual(
    shown.map((row) => row.placeholders.length),
    [0, 0],
  );
  assert.ok(
    byClass(loaded.tree, "v2-dot").every(
      (dot) => dot.props["aria-hidden"] === "true",
    ),
  );
  // Job entries are text, not more stops for Tab: the links are the tools.
  assert.equal(
    nodes(loaded.tree).filter((n) => n.type === "NavLink").length,
    2,
  );
  assert.equal(
    nodes(loaded.tree).filter((n) => n.type === "button").length,
    1,
    "only Show in log",
  );
});

// Fix round 1: while a tool's jobs load, placeholder rows hold the height
// its jobs will take (as many as it will show: its open jobs, at most
// three), so nothing in the menu moves when they arrive. They are
// decorative and of the final row height; a failed load drops them.
test("placeholder rows hold the place of the jobs while they load", () => {
  const status = statusWith({
    mux: { running: 1 },
    unraid: { pending: 2 },
    files: { pending: 4, failed: 3 },
  });
  const loading = rows(menu(status).tree);
  assert.deepEqual(
    loading.map((row) => [row.name, row.placeholders.length, row.jobs.length]),
    [
      ["Muxing", 1, 0],
      ["Disk placement", 2, 0],
      ["Files & permissions", frameStatus.JOBS_SHOWN, 0],
    ],
  );
  for (const slot of loading.flatMap((row) => row.placeholders)) {
    // The structure of a job row (same classes, so the same height), with
    // an off dot and lines that hold only a no-break space.
    assert.equal(slot.type, "li");
    assert.deepEqual(classes(slot), ["v2-job"]);
    assert.deepEqual(classes(byClass(slot, "v2-dot")[0]), [
      "v2-dot",
      "v2-dot--off",
    ]);
    assert.equal(text(byClass(slot, "v2-jobs-name")[0]), "\u00a0");
    assert.equal(text(byClass(slot, "v2-jobs-line")[0]), "\u00a0");
    assert.equal(nodes(slot).filter((n) => n.type === "li").length, 1);
  }
  // Each tool on its own: loaded, failed and still loading side by side.
  const mixed = rows(
    menu(status, {
      jobs: {
        mux: [{ id: 1, name: "Arrival", detail: "", state: "running" }],
        disks: null,
      },
    }).tree,
  );
  assert.deepEqual(
    mixed.map((row) => [row.placeholders.length, row.jobs.length]),
    [
      [0, 1],
      [0, 0],
      [3, 0],
    ],
  );
  // A failed tool has no list at all, as a loaded tool without jobs.
  const failed = menu(status, { jobs: { mux: null, disks: [], files: [] } });
  assert.equal(byClass(failed.tree, "v2-jobs-list").length, 0);
});

test("job requests and rows come from the tools' endpoints", () => {
  const tool = (view, running, pending, failed) => ({
    view,
    open: running + pending + failed,
    running,
    pending,
    failed,
  });
  // Mux lists all its jobs on one endpoint; the item pages ask for the
  // states they have, running first, failed apart, at most three each.
  assert.deepEqual(plain(frameStatus.jobRequests(tool("mux", 1, 0, 0))), [
    "mux/jobs",
  ]);
  assert.deepEqual(plain(frameStatus.jobRequests(tool("disks", 1, 2, 1))), [
    "placement/items?status=running&status=queued&sort=status&dir=desc&limit=3",
    "placement/items?status=failed&status=needs_review&status=needs_attention&sort=status&dir=desc&limit=3",
  ]);
  assert.deepEqual(plain(frameStatus.jobRequests(tool("disks", 0, 0, 2))), [
    "placement/items?status=failed&status=needs_review&status=needs_attention&sort=status&dir=desc&limit=3",
  ]);
  assert.deepEqual(plain(frameStatus.jobRequests(tool("files", 0, 4, 0))), [
    "filecheck/items?status=active&sort=status&dir=desc&limit=3",
  ]);
  assert.deepEqual(plain(frameStatus.jobRequests(tool("files", 1, 0, 1))), [
    "filecheck/items?status=active&sort=status&dir=desc&limit=3",
    "filecheck/items?status=failed&sort=status&dir=desc&limit=3",
  ]);
  assert.equal(frameStatus.JOBS_SHOWN, 3);

  // Mux: the open jobs as the status counts them (drafts and ready jobs
  // wait, attention and review count as failed), running first, then
  // failed, then waiting, at most three; finished ones never.
  const job = (id, status, title, sourceName) => ({
    id,
    status,
    title,
    sourceName,
  });
  assert.deepEqual(
    plain(
      frameStatus.jobRows([
        [
          job(1, "succeeded", "Alien", "Alien.mkv"),
          job(2, "draft", "Brazil", "Brazil.mkv"),
          job(3, "needs_attention", "Casino", "Casino.mkv"),
          job(4, "running", "Dune", "Dune.mkv"),
          job(5, "cancelled", "Elf", "Elf.mkv"),
          job(6, "ready", "Fargo", "Fargo.mkv"),
        ],
      ]),
    ),
    [
      { id: 4, name: "Dune", detail: "Dune.mkv", state: "running" },
      { id: 3, name: "Casino", detail: "Casino.mkv", state: "failed" },
      { id: 2, name: "Brazil", detail: "Brazil.mkv", state: "waiting" },
    ],
  );
  for (const [status, state] of [
    ["draft", "waiting"],
    ["ready", "waiting"],
    ["queued", "waiting"],
    ["running", "running"],
    ["failed", "failed"],
    ["needs_attention", "failed"],
    ["needs_review", "failed"],
  ])
    assert.equal(
      frameStatus.jobRows([[job(1, status, "A", "a.mkv")]])[0]?.state,
      state,
      status,
    );
  for (const status of ["succeeded", "cancelled", "warning", "constructor"])
    assert.deepEqual(
      plain(frameStatus.jobRows([[job(1, status, "A", "a.mkv")]])),
      [],
      status,
    );
  // Items of both requests in one list, each once; cancelled findings are
  // no open jobs. The file is the last part of its path; without a title
  // it is the name.
  const item = (id, jobStatus, title, rel) => ({ id, jobStatus, title, rel });
  assert.deepEqual(
    plain(
      frameStatus.jobRows([
        { items: [item(8, "queued", "Up", "TV/Up/Season 01")] },
        {
          items: [
            item(9, "needs_review", "", "Movies/Big (1988)/Big.mkv"),
            item(10, "cancelled", "Tron", "Movies/Tron/Tron.mkv"),
            item(8, "queued", "Up", "TV/Up/Season 01"),
          ],
        },
      ]),
    ),
    [
      { id: 9, name: "Big.mkv", detail: "", state: "failed" },
      { id: 8, name: "Up", detail: "Season 01", state: "waiting" },
    ],
  );
  // An answer without a list adds nothing.
  assert.deepEqual(plain(frameStatus.jobRows([null, {}, []])), []);
});

// --- useOpenJobs --------------------------------------------------------------

function openJobs(tools, { fail = [], odd = [] } = {}) {
  const calls = [],
    pending = [];
  const runtime = createHookRuntime();
  const { useOpenJobs } = loadSource("hooks/useOpenJobs.ts", {
    browser: { AbortController },
    modules: {
      "preact/hooks": runtime.hooks,
      "../frame-status": frameStatus,
      "../api": {
        api: (path, method, body, signal, options) => {
          calls.push({ path, method, body, options: plain(options), signal });
          return new Promise((resolve, reject) =>
            pending.push(() =>
              fail.some((part) => path.startsWith(part))
                ? reject(new Error("Request failed"))
                : odd.some((part) => path.startsWith(part))
                  ? // An answer jobRows cannot read: items is no list.
                    resolve({ items: 5 })
                  : resolve(
                      path === "mux/jobs"
                        ? [
                            {
                              id: 1,
                              status: "running",
                              title: "Arrival",
                              sourceName: "Arrival.mkv",
                            },
                            { id: 2, status: "succeeded", title: "Heat" },
                          ]
                        : {
                            items: [
                              {
                                id: 3,
                                jobStatus: "queued",
                                title: "Up",
                                rel: "Movies/Up/Up.mkv",
                              },
                            ],
                          },
                    ),
            ),
          );
        },
      },
    },
  });
  let current = tools,
    jobs;
  const render = () => (jobs = runtime.settle(() => useOpenJobs(current)));
  // Answers every request so far, then lets the promises run.
  const answer = async () => {
    for (const run of pending.splice(0)) run();
    await new Promise((resolve) => setImmediate(resolve));
    render();
  };
  render();
  return {
    calls,
    runtime,
    answer,
    render,
    set tools(next) {
      current = next;
    },
    get jobs() {
      return plain(jobs);
    },
  };
}
const tool = (view, running, pending, failed) => ({
  view,
  open: running + pending + failed,
  running,
  pending,
  failed,
});

test("the bell loads its jobs when it opens", async () => {
  const mux = tool("mux", 1, 0, 0),
    files = tool("files", 0, 1, 0);
  const hook = openJobs([mux, files]);
  // On mount, one request per path of each tool, quietly (a failure keeps
  // the tool's row and shows no notice).
  assert.deepEqual(
    hook.calls.map(({ path, method, body, options }) => [
      path,
      method,
      body,
      options,
    ]),
    [
      ["mux/jobs", "GET", undefined, { notifyErrors: false }],
      [
        "filecheck/items?status=active&sort=status&dir=desc&limit=3",
        "GET",
        undefined,
        { notifyErrors: false },
      ],
    ],
  );
  assert.deepEqual(hook.jobs, {}, "nothing until the answers arrive");
  await hook.answer();
  assert.deepEqual(hook.jobs, {
    mux: [{ id: 1, name: "Arrival", detail: "Arrival.mkv", state: "running" }],
    files: [{ id: 3, name: "Up", detail: "Up.mkv", state: "waiting" }],
  });
  // The same counts ask for nothing again.
  hook.tools = [{ ...mux }, { ...files }];
  hook.render();
  assert.equal(hook.calls.length, 2);
  // Changed counts load again; the shown jobs stay until the answer, and
  // the earlier requests are cancelled.
  hook.tools = [tool("mux", 1, 1, 0), files];
  hook.render();
  assert.equal(hook.calls.length, 4);
  assert.ok(hook.calls.slice(0, 2).every((call) => call.signal.aborted));
  assert.equal(hook.jobs.mux.length, 1);
  await hook.answer();
  assert.equal(hook.jobs.mux.length, 1);
  // Closing the menu cancels what is still on its way.
  hook.tools = [tool("mux", 2, 1, 0), files];
  hook.render();
  hook.runtime.unmount();
  assert.ok(hook.calls.every((call) => call.signal.aborted));

  // A tool whose jobs could not be loaded gets null (its row alone); the
  // others still show theirs.
  const failing = openJobs([mux, files], { fail: ["filecheck/"] });
  await failing.answer();
  assert.deepEqual(failing.jobs, {
    mux: [{ id: 1, name: "Arrival", detail: "Arrival.mkv", state: "running" }],
    files: null,
  });
  // No tool with open jobs: no request.
  const none = openJobs([]);
  assert.deepEqual(none.calls, []);
  assert.deepEqual(none.jobs, {});
});

// Fix round 1: an answer jobRows cannot read (it throws) falls back like a
// failed load: the tool's row alone, and no unhandled rejection.
test("an answer the rows cannot read falls back like a failed load", async () => {
  assert.throws(() => frameStatus.jobRows([{ items: 5 }]));
  const unhandled = [];
  const listen = (reason) => unhandled.push(String(reason));
  process.on("unhandledRejection", listen);
  try {
    const hook = openJobs([tool("mux", 1, 0, 0), tool("files", 0, 1, 0)], {
      odd: ["filecheck/"],
    });
    await hook.answer();
    await new Promise((resolve) => setImmediate(resolve));
    assert.deepEqual(hook.jobs, {
      mux: [
        { id: 1, name: "Arrival", detail: "Arrival.mkv", state: "running" },
      ],
      files: null,
    });
    assert.deepEqual(unhandled, []);
  } finally {
    process.off("unhandledRejection", listen);
  }
});

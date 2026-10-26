import test from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
const src = (file) =>
  readFileSync(new URL("../src/" + file, import.meta.url), "utf8");
const component = (name) => src("components/" + name + ".tsx");

test("FileCheck moves all pre-scan controls into its scan dialog", () => {
  const page = component("FileCheckPage");
  assert.match(page, /<FileCheckScanDialog/);
  const filters = page.slice(
    page.indexOf('<div class="filter-groups"'),
    page.indexOf("<ActiveFilterBar"),
  );
  for (const text of [
    "Libraries",
    "Checks",
    "Permissions",
    "Edit allowed and ignored names",
  ])
    assert.ok(
      !filters.includes('t("' + text + '")'),
      text + " must not be an outcome filter",
    );
  assert.match(filters, /t\("Show"\)/);
  assert.match(filters, /<MultiFilter/);
});

test("scan dialog orders services, checks, owner, target permissions and fixing with inline validation", () => {
  const path = new URL(
    "../src/components/FileCheckScanDialog.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(path), "scan dialog exists");
  const code = component("FileCheckScanDialog");
  const labels = [
    "Services",
    "Checks",
    "Target owner",
    "Target permissions",
    "Fixing",
  ];
  let last = -1;
  for (const label of labels) {
    const next = code.indexOf('<h3 class="card-title">{t("' + label + '")}');
    assert.ok(next > last, label + " follows the previous section");
    last = next;
  }
  assert.match(code, /Custom values/);
  assert.match(code, /Reset to default/);
  assert.match(code, /Without this option, permissions only count/);
  assert.match(code, /Select at least one library/);
  assert.match(code, /Select at least one check/);
  assert.match(code, /role="alert"/);
  assert.match(code, /Finish or cancel fixes first/);
  assert.match(code, /allowed:\s*settings\?\.fileCheck\?\.allowed/);
  assert.match(code, /ignore: settings\?\.fileCheck\?\.ignore/);
});

test("manual and failed findings are selectable while fix actions use only fixable selection", () => {
  const code = component("FileCheckPage");
  assert.match(code, /function fileCheckSelectable/);
  const body = code.match(
    /export function fileCheckSelectable\([^]*?\n\}/,
  )?.[0];
  assert.ok(body, "selection predicate exists");
  const predicate = new Function(
    body
      .replace(/export /, "")
      .replace(/item: Pick<FileCheckItem, "jobStatus">/, "item") +
      "; return fileCheckSelectable;",
  )();
  for (const jobStatus of ["", "failed", "cancelled", "needs_review"])
    assert.equal(predicate({ jobStatus, fix: "manual" }), true, jobStatus);
  for (const jobStatus of ["queued", "running", "succeeded"])
    assert.equal(predicate({ jobStatus }), false, jobStatus);
  assert.match(code, /onClick=\{\(\) => fix\(selectedFixable\)\}/);
  assert.match(
    code,
    /results\.selectableIds\.filter\(\s*\(id\) =>\s*selected\.includes\(id\),?\s*\)/,
  );
  assert.match(code, /\{ all: true, query: filterQuery \}/);
  assert.match(code, /Terminal script for all matches/);
});

test("command preview truncates beyond 500 lines and always copies/downloads full script", () => {
  const path = new URL(
    "../src/components/FileCheckCommandsDialog.tsx",
    import.meta.url,
  );
  assert.ok(existsSync(path), "commands dialog exists");
  const code = component("FileCheckCommandsDialog");
  assert.match(code, /lines\.length > 500/);
  assert.match(code, /lines\.slice\(0, 50\)/);
  assert.match(code, /clipboard\.writeText\(text\)/);
  assert.match(code, /new Blob\(\[text\]/);
  assert.match(code, /\.sh/);
});

test("names belong to the Unraid settings draft and checksums follow same-disk mux", () => {
  const code = component("UnraidSettings");
  assert.match(code, /title=\{t\("Files & permissions"\)\}/);
  assert.match(code, /<FileCheckNamesDialog/);
  assert.match(code, /changeFileCheck\(/);
  assert.ok(
    code.indexOf("value.verifyChecksum") > code.indexOf("value.muxSameDisk"),
  );
  assert.match(component("ConnectionSettings"), /changeFileCheck=\{/);
  assert.doesNotMatch(component("FileCheckPage"), /kind: "rules"/);
});

test("file check report begins with scan time and warns when a replacement scan runs", () => {
  const code = component("FileCheckPage");
  assert.match(code, /scanReportTime\(/);
  const report = code.slice(code.indexOf('className="placement-summary"'));
  assert.ok(
    report.indexOf('t("Scanned at")') < report.indexOf('["Items checked"'),
  );
  assert.match(
    report,
    /A new scan is running\. This report shows the previous scan\./,
  );
});

// Evaluate the real component with deterministic hook state and inert JSX nodes.
// Browser integration stays in the release fixture; these exercise event handlers
// and state transitions without making requests or executing generated commands.
import ts from "typescript";
import { runInNewContext } from "node:vm";
import * as fileCheck from "../src/filecheck.ts";
import * as instances from "../src/instances.ts";
function renderHarness(name, props, browser = {}) {
  const state = [];
  let index = 0;
  const exports = {};
  const jsx = (type, props) => ({ type, props });
  const code = ts.transpileModule(component(name), {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      jsx: ts.JsxEmit.ReactJSX,
      jsxImportSource: "preact",
    },
  }).outputText;
  runInNewContext(code, {
    exports,
    Blob,
    setTimeout,
    ...browser,
    require(path) {
      if (path === "preact/jsx-runtime") return { jsx, jsxs: jsx };
      if (path === "preact/hooks")
        return {
          useRef: () => ({ current: null }),
          useState(initial) {
            const slot = index++;
            if (!(slot in state))
              state[slot] = typeof initial === "function" ? initial() : initial;
            return [
              state[slot],
              (next) => {
                state[slot] =
                  typeof next === "function" ? next(state[slot]) : next;
              },
            ];
          },
        };
      if (path === "../filecheck") return fileCheck;
      if (path === "../instances") return instances;
      if (path === "../i18n")
        return {
          useI18n() {},
          t: (key, values = {}) =>
            key.replace(/\{(\w+)\}/g, (_, key) => values[key] ?? ""),
        };
      if (path === "../ui") return { ICON: { label: 15, button: 16 } };
      return new Proxy({}, { get: (_, key) => key });
    },
  });
  return {
    render: () => {
      index = 0;
      return exports[name](props);
    },
    exports,
  };
}
function nodes(tree) {
  if (Array.isArray(tree)) return tree.flatMap(nodes);
  if (!tree || typeof tree !== "object") return [];
  return [tree, ...nodes(tree.props?.children)];
}
function text(tree) {
  if (Array.isArray(tree)) return tree.map(text).join("");
  if (tree && typeof tree === "object") return text(tree.props?.children);
  return tree === undefined || tree === null || typeof tree === "boolean"
    ? ""
    : String(tree);
}
const find = (tree, type, label) =>
  nodes(tree).find(
    (node) => node.type === type && (!label || text(node) === label),
  );
const scanProps = (patch = {}) => ({
  settings: {
    instances: [{ id: "radarr", type: "radarr", enabled: true }],
    unraid: { ownerUid: 99, ownerGid: 100 },
    fileCheck: {
      ...fileCheck.defaultFileCheckSettings,
      allowed: ["saved.nfo"],
      ignore: [".saved"],
    },
  },
  options: { ...fileCheck.defaultFileCheckSettings, libraries: ["radarr"] },
  physical: true,
  fixesActive: false,
  scanning: false,
  start: async () => {},
  openNames() {},
  close() {},
  ...patch,
});

test("scan submission preserves saved names and keeps errors in the open dialog", async () => {
  let payload;
  const harness = renderHarness(
    "FileCheckScanDialog",
    scanProps({
      start: async (next) => {
        payload = next;
        throw new Error("Scan unavailable");
      },
    }),
  );
  await find(harness.render(), "button", "Scan").props.onClick();
  assert.deepEqual(Array.from(payload.allowed), ["saved.nfo"]);
  assert.deepEqual(Array.from(payload.ignore), [".saved"]);
  assert.deepEqual(
    Array.from(payload.libraries),
    [],
    "all enabled services use the compatibility empty selection",
  );
  assert.ok(text(harness.render()).includes("Scan unavailable"));
  assert.equal(find(harness.render(), "button", "Scan").props.disabled, false);
});

test("scan validation blocks missing services/checks and fixes disable only starting", async () => {
  let calls = 0;
  const harness = renderHarness(
    "FileCheckScanDialog",
    scanProps({
      start: async () => {
        calls++;
      },
    }),
  );
  let tree = harness.render();
  const service = nodes(tree).find(
    (node) => node.type === "input" && node.props.type === "checkbox",
  );
  service.props.onChange({ currentTarget: { checked: false } });
  await find(harness.render(), "button", "Scan").props.onClick();
  assert.equal(calls, 0);
  assert.ok(text(harness.render()).includes("Select at least one library"));
  const blocked = renderHarness(
    "FileCheckScanDialog",
    scanProps({ fixesActive: true }),
  ).render();
  assert.equal(find(blocked, "button", "Scan").props.disabled, true);
  assert.equal(
    find(blocked, "button", "Scan").props.title,
    "Finish or cancel fixes first",
  );
  assert.equal(
    nodes(blocked).find((node) => node.type === "input").props.disabled,
    false,
  );
});

test("custom mode exposes inline controls and owner reset returns to Unraid defaults", () => {
  const harness = renderHarness(
    "FileCheckScanDialog",
    scanProps({
      options: {
        ...fileCheck.defaultFileCheckSettings,
        libraries: ["radarr"],
        ownerUid: 1000,
        ownerGid: 101,
      },
    }),
  );
  let tree = harness.render();
  find(tree, "button", "Reset to default").props.onClick();
  tree = harness.render();
  assert.deepEqual(
    nodes(tree)
      .filter((node) => node.type === "input" && node.props.type === "number")
      .map((node) => node.props.value),
    [99, 100],
  );
  const custom = find(tree, "label", "Custom values");
  nodes(custom)
    .find((node) => node.type === "input")
    .props.onChange();
  const inputs = nodes(harness.render()).filter(
    (node) => node.type === "input",
  );
  assert.ok(inputs.some((node) => node.props.placeholder === "0664"));
  assert.ok(inputs.some((node) => node.props.placeholder === "0775"));
});

test("large commands render fifty preview lines but copy all lines; 500 lines remain fully visible", async () => {
  let copied;
  const script =
    Array.from({ length: 501 }, (_, i) => "echo " + i).join("\n") + "\n";
  const harness = renderHarness(
    "FileCheckCommandsDialog",
    { text: script, hostPaths: true, close() {} },
    {
      navigator: {
        clipboard: {
          writeText: async (value) => {
            copied = value;
          },
        },
      },
    },
  );
  const tree = harness.render();
  assert.equal(text(find(tree, "pre")).split("\n").length, 50);
  assert.ok(text(tree).includes("first 50 of 501 lines"));
  await find(tree, "button", "Copy").props.onClick();
  assert.equal(copied, script);
  const small = renderHarness("FileCheckCommandsDialog", {
    text: script.split("\n").slice(0, 500).join("\n"),
    hostPaths: true,
    close() {},
  }).render();
  assert.equal(text(find(small, "pre")).split("\n").length, 500);
  assert.ok(!text(small).includes("first 50"));
});

test("name edits apply normalized lines to the caller draft and then close", () => {
  let saved,
    closed = false;
  const harness = renderHarness("FileCheckNamesDialog", {
    options: fileCheck.defaultFileCheckSettings,
    save: (allowed, ignore) => {
      saved = { allowed, ignore };
    },
    close: () => {
      closed = true;
    },
  });
  const areas = nodes(harness.render()).filter(
    (node) => node.type === "textarea",
  );
  areas[0].props.onInput({
    currentTarget: { value: " custom.nfo \n\nposter.*\n" },
  });
  areas[1].props.onInput({ currentTarget: { value: " .private/\n" } });
  find(harness.render(), "button", "Apply").props.onClick();
  assert.deepEqual(Array.from(saved.allowed), ["custom.nfo", "poster.*"]);
  assert.deepEqual(Array.from(saved.ignore), [".private/"]);
  assert.equal(closed, true);
});

test("name dialog actions never submit the surrounding settings form", () => {
  const tree = renderHarness("FileCheckNamesDialog", {
    options: fileCheck.defaultFileCheckSettings,
    save() {},
    close() {},
  }).render();
  for (const button of nodes(tree).filter((node) => node.type === "button"))
    assert.equal(button.props.type, "button", text(button));
});

test("names dialog ends with its action footer", () => {
  const tree = renderHarness("FileCheckNamesDialog", {
    options: fileCheck.defaultFileCheckSettings,
    save() {},
    close() {},
  }).render();
  const children = tree.props.children.filter(Boolean);
  assert.equal(children.at(-1).props.class, "modal-actions");
});

test("selection lifecycle retains visible manual findings, prunes hidden/active findings on reload and clears page/sort changes", () => {
  const code = component("FileCheckPage");
  const prune = renderHarness("FileCheckPage", {}).exports
    .fileCheckVisibleSelection;
  assert.equal(
    typeof prune,
    "function",
    "reloads prune selections through the visible-row helper",
  );
  let selected = [1, 2, 3, 4];
  const row = (id, jobStatus = "", fix = "manual") => ({ id, jobStatus, fix });
  selected = Array.from(
    prune(selected, [row(1), row(2, "failed"), row(3), row(4)]),
  );
  assert.deepEqual(
    selected,
    [1, 2, 3, 4],
    "manual and failed findings survive an unchanged poll",
  );
  selected = Array.from(
    prune(selected, [
      row(1),
      row(2, "queued"),
      row(3, "running"),
      row(4, "succeeded"),
    ]),
  );
  assert.deepEqual(
    selected,
    [1],
    "polling drops queued, running and succeeded selections",
  );
  selected = Array.from(prune(selected, [row(5), row(6, "failed")]));
  assert.deepEqual(
    selected,
    [],
    "moving to another visible page cannot retain hidden IDs",
  );
  assert.deepEqual(
    Array.from(prune([1, 5], [row(5)])),
    [5],
    "removed rows are pruned while remaining visible selections survive",
  );
  assert.match(
    code,
    /setResults\(list\);\s*setSelected\(\(current\) =>\s*fileCheckVisibleSelection\(current, list\.items\),?\s*\)/,
    "each reload prunes against returned rows",
  );
  assert.match(
    code,
    /useEffect\(\s*\(\) => setSelected\(\[\]\),\s*\[\s*filters,\s*shares,\s*page,\s*formatTableSort\(sort\),?\s*\],?\s*\)/,
    "page and sort changes clear selection even when the visible IDs overlap",
  );
});

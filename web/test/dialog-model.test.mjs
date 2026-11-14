import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

// The dialog model (Phase 5d, task 2): dialog sizes, the confirmation view
// and the toast view. The paging code is in file-paging.test.mjs.

const model = loadSource("dialog-model.ts");
const plain = (value) => JSON.parse(JSON.stringify(value));

test("every dialog has a size and a height mode", () => {
  const sm = { size: "sm", height: "auto" };
  const md = { size: "md", height: "auto" };
  const lg = { size: "lg", height: "auto" };
  assert.deepEqual(plain(model.DIALOGS), {
    confirm: sm,
    savePreset: sm,
    autoTag: sm,
    password: sm,
    renameCompanions: md,
    fileCheckDetails: md,
    targetDisks: md,
    addService: md,
    unraidPathCheck: md,
    tagPolicy: md,
    logEntry: md,
    customTags: { size: "md", height: "fixed" },
    muxStatus: { size: "md", height: "fixed" },
    muxOptions: lg,
    pathCheck: lg,
    placementScan: lg,
    fileCheckScan: lg,
    placementReport: lg,
    fileCheckReport: lg,
    fileCheckCommands: lg,
    fileCheckNames: lg,
    ruleEditor: lg,
    muxLog: { size: "lg", height: "fixed" },
    placementLog: { size: "lg", height: "fixed" },
    placementDetails: { size: "lg", height: "fixed" },
    placementStatus: { size: "lg", height: "fixed" },
    tagReview: { size: "lg", height: "fixed" },
    file: { size: "file", height: "fixed" },
  });
  assert.equal(Object.keys(model.DIALOGS).length, 28);
});

test("the confirmation view keeps the 1.7.0 titles, actions and tones", () => {
  const view = (p) => plain(model.confirmationView(p));
  assert.deepEqual(view({ actionLabel: "Change" }), {
    title: "Confirm action",
    action: "Change",
    tone: "primary",
    icon: null,
  });
  assert.deepEqual(view({ discard: true }), {
    title: "Really cancel?",
    action: "Discard changes",
    tone: "secondary",
    icon: null,
  });
  assert.deepEqual(view({ reset: true }), {
    title: "Restore defaults",
    action: "Restore defaults",
    tone: "secondary",
    icon: "reset",
  });
  assert.deepEqual(view({ danger: true }), {
    title: "Confirm deletion",
    action: "Delete",
    tone: "danger",
    icon: "trash",
  });
  assert.deepEqual(view({ danger: true, actionLabel: "Remove" }), {
    title: "Confirm deletion",
    action: "Remove",
    tone: "danger",
    icon: "trash",
  });
  // ConfirmationDialog.tsx today: a bare confirmation (no flag) is the
  // deletion wording with the danger tone and the trash icon.
  assert.deepEqual(view({}), {
    title: "Confirm deletion",
    action: "Delete",
    tone: "danger",
    icon: "trash",
  });
});

test("toasts keep their roles and durations", () => {
  const view = (kind, linked) => plain(model.toastView(kind, linked));
  assert.deepEqual(view("success", false), {
    tone: "ok",
    icon: "check",
    role: "status",
    duration: 5000,
  });
  assert.deepEqual(view("warning", false), {
    tone: "warn",
    icon: "alert",
    role: "status",
    duration: 8000,
  });
  assert.deepEqual(view("error", false), {
    tone: "error",
    icon: "alert",
    role: "alert",
    duration: 8000,
  });
  // R-J / F3: a toast with a link stays 8 s like an error.
  assert.equal(view("success", true).duration, 8000);
  assert.equal(view("warning", true).duration, 8000);
  assert.equal(view("error", true).duration, 8000);
});

test("the sort adapter moved with SortHeader", () => {
  const { asFilmSort } = loadSource("components/list/SortHeader.tsx", {
    modules: {
      "preact/hooks": {},
      "../../i18n": {},
      "../../ui": {},
      "../frame/Popover": {},
    },
  });
  assert.deepEqual(plain(asFilmSort(null, "priority")), {
    field: "priority",
    direction: "asc",
  });
  assert.deepEqual(plain(asFilmSort(null, "")), {
    field: "",
    direction: "asc",
  });
  assert.deepEqual(plain(asFilmSort({ field: "ts", direction: "desc" }, "")), {
    field: "ts",
    direction: "desc",
  });
  assert.deepEqual(
    plain(asFilmSort({ field: "name", direction: "asc" }, "priority")),
    { field: "name", direction: "asc" },
  );
});

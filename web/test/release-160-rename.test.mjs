import test from "node:test";
import assert from "node:assert/strict";
import {
  dialog,
  nodes,
  preview,
  rename,
  text,
} from "./helpers/rename-dialog.mjs";

test("rename preview displays media and companion devices on the real disk tags", () => {
  const tree = dialog(preview());
  const tags = nodes(tree).filter((node) => node.type?.name === "ToolDiskTag");
  assert.deepEqual(
    tags.map((node) => node.props.disk),
    ["disk1", "cache"],
  );
  for (const node of tags) {
    const rendered = node.type(node.props);
    assert.equal(
      text(nodes(rendered).find((n) => n.props?.class?.startsWith("v2-tag"))),
      node.props.disk,
    );
  }
  assert.match(text(tree), /New\.mkv/);
  assert.match(text(tree), /Old\.de\.srt → New\.de\.srt/);
});

test("user-share preview explains setup and leaves unsupported disk locations blank", () => {
  const tree = dialog(
    preview({
      device: "",
      userShare: true,
      companions: [
        { from: "Old.srt", to: "New.srt", conflict: false, device: "" },
      ],
    }),
  );
  const hint = nodes(tree).find(
    (node) => node.props?.class === "v2-modal-hint",
  );
  assert.ok(hint, "missing user share hint");
  assert.equal(text(hint), "Renamed through the user share");
  assert.equal(
    hint.props.title,
    "Set up Unraid under Settings → Services → Unraid to rename directly on the disk.",
  );
  assert.equal(
    nodes(tree).filter((node) => node.type?.name === "ToolDiskTag").length,
    0,
  );
});

test("companion device information preserves explicit conflict blocking and media-only action", () => {
  const calls = [];
  const p = preview();
  p.companions[0].conflict = true;
  const tree = dialog(p, (value) => calls.push(value));
  // The companions' box is locked off; the one button renames the media
  // file only (F4: 1.7.0's "Only the media file").
  const all = nodes(tree).find(
    (node) =>
      node.type === "label" && text(node) === "Rename companion files too",
  );
  const box = nodes(all).find((node) => node.type === "input");
  const media = nodes(tree.props.foot).find(
    (node) => node.type === "button" && text(node) === "Rename file",
  );
  assert.equal(box.props.disabled, true);
  assert.equal(box.props.checked, false);
  media.props.onClick();
  assert.deepEqual(calls, [false]);
});

test("completed refreshes warn when new devices or a verification warning are returned", () => {
  assert.equal(typeof rename.renameResultTone, "function");
  assert.equal(
    rename.renameResultTone({ refresh: "completed", newDevices: [] }),
    "success",
  );
  assert.equal(
    rename.renameResultTone({ refresh: "completed", newDevices: ["cache"] }),
    "warning",
  );
  assert.equal(
    rename.renameResultTone({
      refresh: "completed",
      warning: "Folder locations could not be checked.",
    }),
    "warning",
  );
  assert.equal(rename.renameResultTone({ refresh: "pending" }), "warning");
  assert.equal(rename.renameResultTone({ refresh: "failed" }), "warning");
});

test("media-only rename preview retains disk/fallback explanation and one explicit rename action", () => {
  const calls = [];
  const tree = dialog(
    preview({ companions: [], userShare: true, device: "" }),
    (value) => calls.push(value),
  );
  const renameButton = nodes(tree.props.foot).find(
    (node) => node.type === "button" && text(node) === "Rename file",
  );
  assert.ok(renameButton);
  assert.ok(
    nodes(tree).some(
      (node) =>
        node.props?.class === "v2-modal-hint" &&
        text(node) === "Renamed through the user share",
    ),
  );
  renameButton.props.onClick();
  assert.deepEqual(calls, [false]);
  assert.equal(
    nodes(tree).some((node) => text(node) === "Rename companion files too"),
    false,
  );
});

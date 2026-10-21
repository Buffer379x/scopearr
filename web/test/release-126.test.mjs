import test from "node:test";
import assert from "node:assert/strict";
import {
  splitFilename,
  renameState,
  companionDecision,
} from "../src/file-rename.ts";
import {
  confirmAction,
  currentConfirmation,
  answerConfirmation,
} from "../src/confirmation.ts";
test("rename preserves the original extension, literal dots and extensionless files", () => {
  for (const [filename, stem, extension] of [
    ["a.b.mkv", "a.b", ".mkv"],
    ["Episode.MP4", "Episode", ".MP4"],
    ["Movie", "Movie", ""],
  ]) {
    assert.deepEqual(splitFilename(filename), [stem, extension]);
    assert.equal(stem + extension, filename);
  }
});
test("rename save rejects invalid or unchanged stems and permits case-only changes", () => {
  assert.equal(renameState("Movie.mkv", "Movie").canSave, false);
  assert.equal(renameState("Movie.mkv", "movie").canSave, true);
  for (const name of [
    "",
    ".Movie",
    "../x",
    "a/b",
    "a\\b",
    "a\n",
    "a".repeat(201),
    "ä".repeat(101),
    "x.partial",
    "x.scopearr-backup-1",
  ]) {
    assert.equal(renameState("Movie.mkv", name).canSave, false, name);
  }
  assert.equal(renameState("Movie.avi", "New.mkv").canSave, true);
});
test("companion decisions use simple confirmation for empty previews and block conflicting companion targets", () => {
  assert.deepEqual(companionDecision([]), {
    confirm: true,
    canRenameAll: true,
  });
  const c = { from: "Old.de.srt", to: "New.de.srt", conflict: false };
  assert.deepEqual(companionDecision([c]), {
    confirm: false,
    canRenameAll: true,
  });
  assert.deepEqual(companionDecision([c, { ...c, conflict: true }]), {
    confirm: false,
    canRenameAll: false,
  });
});
test("neutral confirmation retains its action and cancellation resolves without accepting", async () => {
  const result = confirmAction("Rename this file?", "Rename file");
  assert.equal(currentConfirmation().actionLabel, "Rename file");
  assert.equal(currentConfirmation().reset, undefined);
  answerConfirmation(false);
  assert.equal(await result, false);
});

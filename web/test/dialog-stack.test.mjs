import test from "node:test";
import assert from "node:assert/strict";
import { topmost } from "../src/dialog-stack.ts";
test("dialog stack returns the latest open dialog", () => {
  const first = { open: true },
    closed = { open: false },
    last = { open: true };
  assert.equal(topmost([]), null);
  assert.equal(topmost([closed]), null);
  assert.equal(topmost([first, closed, last]), last);
  last.open = false;
  assert.equal(topmost([first, closed, last]), first);
});

// rc.4 R9: a new page closes the modals open before it, topmost first,
// through their owners; one without an owner's close closes natively, and
// one that is gone or closed already, or opened since, is left alone.
test("closeDialogs closes the modals of the page that left", async () => {
  globalThis.window ??= new EventTarget();
  const { closeDialogs, openDialogs, pushDialog, removeDialog } =
    await import("../src/dialog-stack.ts");
  const order = [];
  const modal = (name, owned = true) => {
    const dialog = {
      name,
      open: true,
      isConnected: true,
      close() {
        order.push(name + " (native)");
        this.open = false;
      },
    };
    pushDialog(
      dialog,
      owned
        ? () => {
            order.push(name);
            dialog.open = false;
            removeDialog(dialog);
          }
        : undefined,
    );
    return dialog;
  };
  const file = modal("file"),
    native = modal("native", false),
    preview = modal("preview"),
    gone = modal("gone");
  gone.isConnected = false;
  const before = openDialogs();
  assert.deepEqual(
    before.map((d) => d.name),
    ["file", "native", "preview"],
  );
  const later = modal("later");
  closeDialogs(before);
  assert.deepEqual(order, ["preview", "native (native)", "file"]);
  assert.equal(later.open, true);
  assert.deepEqual(
    openDialogs().map((d) => d.name),
    ["later"],
  );
  for (const d of [file, native, preview, gone, later]) removeDialog(d);
});

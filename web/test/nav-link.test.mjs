import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";

const { isPlainClick, followLink } = loadSource("nav-link.ts");
const plainClick = {
  button: 0,
  ctrlKey: false,
  metaKey: false,
  shiftKey: false,
  altKey: false,
};

test("only plain left clicks stay in the app", () => {
  // What a click does: preventDefault and open, in this order, or nothing.
  const click = (event = {}) => {
    const done = [];
    followLink(
      {
        ...plainClick,
        ...event,
        preventDefault: () => done.push("preventDefault"),
      },
      () => done.push("open"),
    );
    return done;
  };
  // The middle and right buttons and Ctrl, Cmd, Shift and Alt keep the
  // browser's link (a new tab or window).
  for (const event of [
    { button: 1 },
    { button: 2 },
    { ctrlKey: true },
    { metaKey: true },
    { shiftKey: true },
    { altKey: true },
  ]) {
    const name = JSON.stringify(event);
    assert.equal(isPlainClick({ ...plainClick, ...event }), false, name);
    assert.deepEqual(click(event), [], name);
  }
  // A plain left click (also Enter on a link) opens the target in the app.
  assert.equal(isPlainClick(plainClick), true);
  assert.deepEqual(click(), ["preventDefault", "open"]);
});

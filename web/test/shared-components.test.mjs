import test from "node:test";
import assert from "node:assert/strict";
import { readdirSync } from "node:fs";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";
import { src } from "./helpers/sources.mjs";

const modules = { "../ui": { ICON: { button: 16 }, count: String } };

function render(props) {
  return componentHarness("Pagination", props, { modules }).render();
}

test("pagination renders the shared tool markup", () => {
  const calls = [];
  const props = {
    page: 2,
    pages: 3,
    setPage: (page) => calls.push(page),
    summary: "101–200 of 250",
    summaryTitle: "Items in the list",
  };
  const tree = render(props);
  assert.equal(tree.type, "div");
  assert.equal(tree.props.class, "pagination");
  const [summary, controls] = tree.props.children;
  assert.equal(summary.type, "span");
  assert.equal(summary.props.title, "Items in the list");
  assert.equal(text(summary), "101–200 of 250");
  const buttons = nodes(controls).filter((n) => n.type === "button");
  assert.equal(buttons.length, 2);
  const [previous, next] = buttons;
  assert.equal(previous.props["aria-label"], "Previous page");
  assert.equal(previous.props.title, "Previous page");
  assert.equal(next.props["aria-label"], "Next page");
  assert.equal(next.props.title, "Next page");
  assert.equal(previous.props.class, "icon-button");
  assert.equal(previous.props.disabled, false);
  assert.equal(next.props.disabled, false);
  assert.equal(text(find(controls, "span")), "Page 2 / 3");
  previous.props.onClick();
  next.props.onClick();
  assert.deepEqual(calls, [1, 3]);
  assert.equal("type" in previous.props && previous.props.type, undefined);

  const first = nodes(render({ ...props, page: 1 })).filter(
    (n) => n.type === "button",
  );
  assert.equal(first[0].props.disabled, true);
  assert.equal(first[1].props.disabled, false);
  const last = nodes(render({ ...props, page: 3 })).filter(
    (n) => n.type === "button",
  );
  assert.equal(last[0].props.disabled, false);
  assert.equal(last[1].props.disabled, true);

  const typed = nodes(render({ ...props, buttonType: "button" })).filter(
    (n) => n.type === "button",
  );
  assert.deepEqual(
    typed.map((n) => n.props.type),
    ["button", "button"],
  );
  assert.equal(
    nodes(render({ ...props, summaryTitle: undefined })).find(
      (n) => n.type === "span",
    ).props.title,
    undefined,
  );
});

test("item ranges count from one and show zero for empty lists", () => {
  const { exports } = componentHarness("Pagination", {}, { modules });
  assert.equal(exports.itemRange(1, 100, 0), "0–0 of 0");
  assert.equal(exports.itemRange(2, 100, 250), "101–200 of 250");
  assert.equal(exports.itemRange(3, 100, 250), "201–250 of 250");
});

test("only the placement disk list keeps an inline pagination", () => {
  // The placement disk list is aligned in phase 5.
  const hits = readdirSync(new URL("../src/components/", import.meta.url))
    .filter((f) => f.endsWith(".tsx") && f !== "Pagination.tsx")
    .filter((f) => src("components/" + f).includes('class="pagination"'));
  assert.deepEqual(hits, ["PlacementDialogs.tsx"]);
});

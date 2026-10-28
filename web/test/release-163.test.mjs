import test from "node:test";
import assert from "node:assert/strict";
import {
  componentHarness,
  find,
  nodes,
  text,
} from "./helpers/component-harness.mjs";

test("commands without selection explain current-filter scope and offer only all-matches download", async () => {
  let downloaded = 0;
  const h = componentHarness("FileCheckCommandsDialog", {
    text: "",
    hostPaths: true,
    total: 1200,
    downloadAll: () => {
      downloaded++;
    },
    close() {},
  });
  const tree = h.render();
  assert.match(text(tree), /No findings selected.*1200 findings/);
  assert.equal(find(tree, "pre"), undefined);
  assert.equal(find(tree, "button", "Copy"), undefined);
  const footer = nodes(tree).find(
    (node) => node.props?.class === "modal-actions",
  );
  assert.equal(
    text(footer.props.children[0]),
    "Download script for all 1200 matches",
  );
  await find(
    tree,
    "button",
    "Download script for all 1200 matches",
  ).props.onClick();
  assert.equal(downloaded, 1);
});

test("selected commands keep complete copy payload alongside all-matches action", async () => {
  const script = Array.from({ length: 501 }, (_, i) => `# row ${i}`).join("\n");
  let copied;
  const h = componentHarness(
    "FileCheckCommandsDialog",
    {
      text: script,
      hostPaths: true,
      total: 1200,
      downloadAll() {},
      close() {},
    },
    {
      browser: {
        navigator: {
          clipboard: {
            writeText: async (value) => {
              copied = value;
            },
          },
        },
      },
    },
  );
  const tree = h.render();
  assert.equal(text(find(tree, "pre")).split("\n").length, 50);
  await find(tree, "button", "Copy").props.onClick();
  assert.equal(copied, script);
  assert.ok(find(h.render(), "button", "Download script for all 1200 matches"));
});

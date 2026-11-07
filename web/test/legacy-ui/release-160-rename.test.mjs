// Legacy UI (1.7.0 look) – replaced in Phase 5d by the v2 rename dialog and disk tag tests.
import test from "node:test";
import assert from "node:assert/strict";
import { dialog, nodes, preview } from "../helpers/rename-dialog.mjs";

test("rename preview displays media and companion devices on the real disk tags (1.7.0 look)", () => {
  const tree = dialog(preview());
  const tags = nodes(tree).filter((node) => node.type?.name === "DiskTag");
  assert.equal(tags.length, 2);
  for (const node of tags) {
    const rendered = node.type(node.props);
    assert.ok(
      nodes(rendered).some((child) =>
        child.props?.class?.includes("placement-disk-tag"),
      ),
    );
  }
});

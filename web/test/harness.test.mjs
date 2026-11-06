import test from "node:test";
import assert from "node:assert/strict";
import { loadSource } from "./helpers/component-harness.mjs";
import { readSources } from "./helpers/sources.mjs";

test("loadSource runs a source module with explicit dependencies and rejects unknown ones", () => {
  const effects = [];
  const hooks = {
    useRef: (current) => ({ current }),
    useEffect: (effect, deps) => effects.push({ effect, deps }),
  };
  const { usePolling } = loadSource("hooks/usePolling.ts", {
    modules: { "preact/hooks": hooks },
  });
  usePolling(
    async () => 1,
    () => null,
    ["dep"],
  );
  assert.equal(effects.length, 1);
  assert.deepEqual(effects[0].deps, ["dep"]);
  assert.throws(
    () => loadSource("hooks/usePolling.ts"),
    /Unexpected dependency: preact\/hooks in hooks\/usePolling\.ts/,
  );
});

test("readSources rejects an empty list so negative assertions cannot pass vacuously", () => {
  assert.throws(() => readSources([]), /readSources needs at least one path/);
});

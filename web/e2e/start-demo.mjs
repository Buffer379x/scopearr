// Starts a fresh synthetic demo for the browser checks.
// The data folder is recreated on every start so runs never share state.
import { spawn, spawnSync } from "node:child_process";
import { mkdirSync, rmSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const root = resolve(here, "../..");
const data = join(here, ".data");

rmSync(data, { recursive: true, force: true });
mkdirSync(join(data, "app"), { recursive: true });

const child = spawn("go", ["run", "./cmd/scopearr"], {
  cwd: root,
  stdio: "inherit",
  env: {
    ...process.env,
    SCOPEARR_DEMO: "true",
    SCOPEARR_DEMO_DISCS: "true",
    SCOPEARR_DATA_DIR: join(data, "app"),
    SCOPEARR_LISTEN: "127.0.0.1:18080",
  },
});

// `go run` does not pass SIGTERM on to the program it built, so the signal
// goes to the program first and then to `go run` itself.
const forward = (signal) => {
  if (child.exitCode !== null || child.signalCode !== null) return;
  spawnSync("pkill", [
    `-${signal.replace(/^SIG/, "")}`,
    "-P",
    String(child.pid),
  ]);
  child.kill(signal);
};
for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"]) {
  process.on(signal, () => forward(signal));
}

child.on("error", (error) => {
  console.error(`Could not start the demo: ${error.message}`);
  process.exit(1);
});
child.on("exit", (code, signal) => {
  process.exit(code ?? (signal ? 1 : 0));
});

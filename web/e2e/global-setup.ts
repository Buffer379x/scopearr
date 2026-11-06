// Signs in to the demo, turns on the tool pages and stores the session
// so every test starts signed in.
import { request, type FullConfig } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const authFile = join(here, ".auth", "demo.json");
const muxWork = join(here, ".data", "mux-work");

export default async function globalSetup(config: FullConfig) {
  const baseURL = String(config.projects[0].use.baseURL);
  const api = await request.newContext({
    baseURL,
    extraHTTPHeaders: { Origin: baseURL },
  });
  try {
    const login = await api.post("/api/login", {
      data: { username: "demo", password: "Scopearr-demo-2026", token: "" },
    });
    if (!login.ok()) {
      throw new Error(
        `Demo sign-in failed: ${login.status()} ${await login.text()}`,
      );
    }
    const status = await api.get("/api/status");
    const csrf = (await status.json()).csrf as string | undefined;
    if (!status.ok() || !csrf) {
      throw new Error(`No CSRF token from /api/status: ${status.status()}`);
    }
    const current = await api.get("/api/settings");
    if (!current.ok()) {
      throw new Error(`Reading settings failed: ${current.status()}`);
    }
    const settings = await current.json();
    mkdirSync(muxWork, { recursive: true });
    settings.mux = {
      ...settings.mux,
      enabled: true,
      mappings: "/media => /media",
      workDir: muxWork,
    };
    settings.unraid = { ...settings.unraid, enabled: true };
    const saved = await api.put("/api/settings", {
      data: settings,
      headers: { "X-CSRF-Token": csrf },
    });
    if (!saved.ok()) {
      throw new Error(
        `Saving settings failed: ${saved.status()} ${await saved.text()}`,
      );
    }
    mkdirSync(dirname(authFile), { recursive: true });
    await api.storageState({ path: authFile });
  } finally {
    await api.dispose();
  }
}

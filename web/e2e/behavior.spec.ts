// Behavior of the current interface that the restructuring must keep:
// unsaved settings, navigation state, the open-log event, polling and startup.
// Nothing here saves settings, because all tests share one demo database.
import { expect, test, type Page } from "@playwright/test";
import { goTo, openApp, recordApi, settingsSection, settle } from "./app";

// Waits for the "Really cancel?" dialog and answers it.
async function answerDiscard(page: Page, answer: "Cancel" | "Discard changes") {
  const dialog = page.getByRole("dialog", { name: "Really cancel?" });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: answer, exact: true }).click();
  await expect(dialog).toBeHidden();
}

// Whether a cancelable beforeunload event is held back by the page. A plain
// Event would treat `returnValue = ""` as cancelling, so the browser's own
// BeforeUnloadEvent is used: it asks only when cancelled or given a message.
function leaveIsBlocked(page: Page): Promise<boolean> {
  return page.evaluate(() => {
    const event = document.createEvent("BeforeUnloadEvent");
    event.initEvent("beforeunload", false, true);
    window.dispatchEvent(event);
    return event.defaultPrevented || event.returnValue !== "";
  });
}

function sectionButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Settings sections" })
    .getByRole("button", { name, exact: true });
}

function heading(page: Page, name: string) {
  return page.getByRole("heading", { level: 1, name, exact: true });
}

test("settings keep unsaved changes until they are discarded", async ({
  page,
}) => {
  await openApp(page);
  await goTo(page, "settings");
  await settingsSection(page, "Display");
  const entries = page.getByLabel("Entries per page", { exact: true });
  const before = await entries.inputValue();
  const changed = before === "37" ? "38" : "37";
  await entries.fill(changed);
  // The page listens again after it renders the change.
  await expect.poll(() => leaveIsBlocked(page)).toBe(true);

  await sectionButton(page, "Widgets").click();
  await answerDiscard(page, "Cancel");
  await expect(sectionButton(page, "Display")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(entries).toHaveValue(changed);

  const dashboard = page
    .getByRole("banner")
    .getByRole("navigation", { name: "Main navigation" })
    .getByRole("button", { name: "Dashboard", exact: true });
  await dashboard.click();
  await answerDiscard(page, "Cancel");
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(entries).toHaveValue(changed);

  await dashboard.click();
  await answerDiscard(page, "Discard changes");
  await expect(heading(page, "Dashboard")).toBeVisible();
  await expect.poll(() => leaveIsBlocked(page)).toBe(false);
});

test("navigation survives a reload and a new sign-in", async ({
  page,
  context,
}) => {
  await openApp(page);
  await goTo(page, "settings");
  await settingsSection(page, "System");
  await page.reload();
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settle(page);

  await goTo(page, "placement");
  // Only this browser context loses its session; e2e/.auth/demo.json stays valid.
  await context.clearCookies();
  await page.evaluate(() =>
    window.dispatchEvent(new Event("scopearr:unauthorized")),
  );
  await expect(
    page.getByText("Your session expired. Sign in again.", { exact: true }),
  ).toBeVisible();
  // The demo fills in its credentials.
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  await expect(heading(page, "Disk placement")).toBeVisible();
});

test("the open-log event switches settings to System", async ({ page }) => {
  const openLog = () =>
    page.evaluate(() => window.dispatchEvent(new Event("scopearr-open-log")));
  await openApp(page);
  await goTo(page, "movies");
  await openLog();
  await expect(heading(page, "Settings")).toBeVisible();
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await settle(page);

  await settingsSection(page, "Display");
  await openLog();
  await expect(sectionButton(page, "System")).toHaveAttribute(
    "aria-pressed",
    "true",
  );
  await expect(
    page
      .getByRole("tablist", { name: "System sections" })
      .getByRole("tab", { name: "Log", exact: true }),
  ).toHaveAttribute("aria-selected", "true");
});

// Longest delay between two list requests while nothing runs, from
// DiskPlacementPage.tsx and FileCheckPage.tsx (10000 ms), plus 2 s.
const IDLE_WAIT_MS = 10_000 + 2_000;
// Requests the dashboard makes itself, measured on 1.7.0 interface.
// None of them belongs to a tool page poll.
const dashboardLoads = ["mux/jobs", "statistics", "storage"];
const toolPolls = [
  {
    view: "placement" as const,
    list: "placement/items",
    polled: (path: string) =>
      path.startsWith("placement/") || path === "unraid/status",
  },
  {
    view: "files" as const,
    list: "filecheck/items",
    polled: (path: string) => path.startsWith("filecheck/"),
  },
];

test("tool pages poll once and stop after leaving", async ({ page }) => {
  test.setTimeout(90_000);
  const api = recordApi(page);
  await openApp(page);
  for (const tool of toolPolls) {
    await test.step(tool.view, async () => {
      let mark = api.mark();
      await goTo(page, tool.view);
      const lists = api.since(mark).filter((call) => call.path === tool.list);
      expect(lists, `${tool.list} requests`).toHaveLength(1);

      mark = api.mark();
      await goTo(page, "dashboard");
      await page.waitForTimeout(IDLE_WAIT_MS);
      const after = api.since(mark).map((call) => call.path);
      expect(
        after.filter(tool.polled),
        `requests after leaving ${tool.view}`,
      ).toEqual([]);
      expect(
        after.filter(
          (path) => path !== "status" && !dashboardLoads.includes(path),
        ),
        "requests besides the dashboard's own",
      ).toEqual([]);
    });
  }
});

test("startup loads the same API endpoints", async ({ page }) => {
  const api = recordApi(page);
  await openApp(page);
  const counts = new Map<string, number>();
  for (const { path } of api.all())
    if (path !== "status") counts.set(path, (counts.get(path) || 0) + 1);
  expect([...counts.keys()].sort()).toEqual([
    "custom-tags",
    "mux/jobs",
    "presets",
    "settings",
    "statistics",
    "storage",
    "tag-presentation",
  ]);
  // measured on 1.7.0 interface
  expect({
    settings: counts.get("settings"),
    presets: counts.get("presets"),
    "custom-tags": counts.get("custom-tags"),
    "tag-presentation": counts.get("tag-presentation"),
  }).toEqual({
    settings: 1,
    presets: 1,
    "custom-tags": 1,
    "tag-presentation": 2,
  });
});

test("theme toggle updates the document and storage", async ({ page }) => {
  await openApp(page, { theme: "dark" });
  const header = page.getByRole("banner");
  const theme = () =>
    page.evaluate(() => ({
      document: document.documentElement.dataset.theme,
      stored: localStorage.getItem("scopearr-theme"),
    }));
  expect(await theme()).toEqual({ document: "dark", stored: "dark" });

  await header
    .getByRole("button", { name: "Light theme", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  expect(await theme()).toEqual({ document: "light", stored: "light" });

  await header.getByRole("button", { name: "Dark theme", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(await theme()).toEqual({ document: "dark", stored: "dark" });
});

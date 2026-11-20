import { useEffect, useState } from "preact/hooks";
import { api } from "../api";
import { jobRequests, jobRows } from "../frame-status";
import type { JobRow, jobsSummary } from "../frame-status";
import type { ToolView } from "../router";

type JobTool = ReturnType<typeof jobsSummary>["tools"][number];

// The open jobs of the bell's tools (ruling R-B): loaded when the jobs menu
// opens, never at startup, from the endpoints of the tool pages, and again
// when a tool's counts change while it is open. A tool has no entry until
// its jobs arrive and null when they could not be loaded or read; the menu
// then shows the tool's row alone, so a failure needs no notice. Closing
// the menu cancels what is still on its way.
export function useOpenJobs(
  tools: JobTool[],
): Partial<Record<ToolView, JobRow[] | null>> {
  const [jobs, setJobs] = useState<Partial<Record<ToolView, JobRow[] | null>>>(
    {},
  );
  const counts = tools
    .map((tool) => [tool.view, tool.running, tool.pending, tool.failed])
    .join(" ");
  useEffect(() => {
    const request = new AbortController();
    for (const tool of tools)
      Promise.all(
        jobRequests(tool).map((path) =>
          api<unknown>(path, "GET", undefined, request.signal, {
            notifyErrors: false,
          }),
        ),
      )
        .then(jobRows)
        .catch(() => null)
        .then((rows) => {
          if (!request.signal.aborted)
            setJobs((current) => ({ ...current, [tool.view]: rows }));
        });
    return () => request.abort();
  }, [counts]);
  return jobs;
}

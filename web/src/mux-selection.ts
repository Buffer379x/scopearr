import type { FileKey, MuxJob } from "./types";
import { fileKey } from "./file-selection.ts";
export type MuxSelectionResult = {
  done: number;
  total: number;
  ok: number;
  failed: number;
  skipped: number;
  reason: string;
};
export async function processMuxSelection(
  files: FileKey[],
  jobs: MuxJob[],
  remove: boolean,
  request: (path: string, method: string, body?: unknown) => Promise<unknown>,
  update: (done: number) => void,
): Promise<MuxSelectionResult> {
  const byFile = new Map(jobs.map((j) => [j.service + ":" + j.fileId, j]));
  const result: MuxSelectionResult = {
    done: 0,
    total: files.length,
    ok: 0,
    failed: 0,
    skipped: 0,
    reason: "",
  };
  for (const key of files) {
    const job = byFile.get(fileKey(key));
    try {
      if (remove) {
        if (
          !job ||
          ["running", "queued"].includes(job.status) ||
          job.backupName
        )
          result.skipped++;
        else {
          await request("mux/jobs?id=" + job.id, "DELETE");
          result.ok++;
        }
      } else if (!job) {
        await request("mux/jobs", "POST", {
          service: key.service,
          fileId: key.id,
        });
        result.ok++;
      }
    } catch (error) {
      result.failed++;
      result.reason ||= (error as Error).message;
    }
    update(++result.done);
  }
  return result;
}

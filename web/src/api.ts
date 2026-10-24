import { notify } from "./notifications";
import { getLocale, t } from "./i18n";
export class ApiError extends Error {
  constructor(
    public data: { error?: string; preset?: { name: string } },
    public status = 0,
  ) {
    super(t(data.error || "Request failed"));
  }
}
let csrf = "";
export async function api<T>(
  path: string,
  method = "GET",
  body?: unknown,
  signal?: AbortSignal,
  options?: { notifyErrors?: boolean },
): Promise<T> {
  try {
    const res = await fetch("/api/" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        "X-CSRF-Token": csrf,
        "Accept-Language": getLocale(),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal,
    });
    const data = await res.json();
    if (!res.ok) {
      if (res.status === 401 && path !== "login")
        window.dispatchEvent(new Event("scopearr:unauthorized"));
      throw new ApiError(data, res.status);
    }
    return data;
  } catch (error) {
    if (
      options?.notifyErrors !== false &&
      (error as Error).name !== "AbortError" &&
      path !== "status" &&
      (!(error instanceof ApiError) || error.status !== 401 || path === "login")
    ) {
      notify((error as Error).message, "error");
      // Callers use this to avoid reporting the same failure twice.
      if (error instanceof Error)
        (error as Error & { notified?: boolean }).notified = true;
    }
    throw error;
  }
}

export function setCSRF(value: string) {
  csrf = value;
}

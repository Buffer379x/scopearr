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
    if (res.status === 401 && path !== "login")
      window.dispatchEvent(new Event("scopearr:unauthorized"));
    let data;
    try {
      if (
        !res.headers
          .get("Content-Type")
          ?.toLowerCase()
          .includes("application/json")
      )
        throw new ApiError({ error: "Request failed" }, res.status);
      data = await res.json();
    } catch (error) {
      if ((error as Error).name === "AbortError") throw error;
      throw new ApiError({ error: "Request failed" }, res.status);
    }
    if (!res.ok) {
      throw new ApiError(
        data && typeof data.error === "string"
          ? data
          : { error: "Request failed" },
        res.status,
      );
    }
    return data;
  } catch (caught) {
    const error =
      caught instanceof TypeError
        ? new ApiError({ error: "Scopearr is not reachable" }, 0)
        : caught;
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

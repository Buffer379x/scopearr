import type { api } from "./api";
import type { SearchOption } from "./nav-model";
import type { MediaFile, Results, Service } from "./types";

// Quick search's titles (E18): a chunk of its own, loaded with the first
// title search (the Library chunk's budget, E24). It imports nothing at
// run time and gets `api` from its caller: a chunk that imported a shared
// module would make the bundler move that module into a new startup chunk.
export type TitleHits = Record<Service, SearchOption[]>;

// A library's titles in the order of its answer, each once: a movie with
// its year, the episodes of a series folded into the series. The same
// title in two instances is one too: it opens the same filtered list
// (ruling R-C).
export function titleHits(service: Service, files: MediaFile[]) {
  const series = service === "sonarr",
    hits = new Map<string, SearchOption>();
  for (const file of files) {
    const label = series ? file.series : file.title,
      meta = series ? "" : String(file.years?.[0] ?? ""),
      key = label + "\n" + meta;
    if (label && !hits.has(key))
      hits.set(key, {
        key,
        label,
        meta,
        icon: series ? "series" : "movies",
        target: {
          view: "library",
          service,
          query: new URLSearchParams({ q: label }).toString(),
        },
      });
  }
  return [...hits.values()];
}

// The first 6 matches of each library (its FTS search, /api/files with
// limit), quietly: a library whose answer fails finds nothing.
export async function findTitles(
  get: typeof api,
  query: string,
  signal: AbortSignal,
): Promise<TitleHits> {
  const [radarr, sonarr] = await Promise.all(
    (["radarr", "sonarr"] as const).map((service) =>
      get<Results>(
        "files?" +
          new URLSearchParams({
            service,
            mode: "matches",
            q: query,
            limit: "6",
          }),
        "GET",
        undefined,
        signal,
        { notifyErrors: false },
      )
        .then((answer) => titleHits(service, answer.files))
        .catch(() => []),
    ),
  );
  return { radarr, sonarr };
}

type Translate = (
  key: string,
  parameters?: Record<string, string | number>,
) => string;
export function placementMessage(
  message: string,
  translate: Translate,
): string {
  const moved = /^Moved to ([A-Za-z0-9_-]+)$/.exec(message);
  if (moved) return translate("Moved to {disk}", { disk: moved[1] });
  const partial =
    /^Partially moved: (\d+) of (\d+) files\. Check again to continue\.$/.exec(
      message,
    );
  if (partial)
    return translate(
      "Partially moved: {done} of {total} files. Check again to continue.",
      { done: partial[1], total: partial[2] },
    );
  if (message.startsWith("Moving "))
    return translate("Moving {file}", { file: message.slice(7) });
  for (const [prefix, key, parameter] of [
    [
      "Could not read folder metadata: ",
      "Could not read folder metadata: {disk}",
      "disk",
    ],
    [
      "Could not read library folders: ",
      "Could not read library folders: {library}",
      "library",
    ],
    [
      "Media folder contains a symbolic link: ",
      "Media folder contains a symbolic link: {disk}",
      "disk",
    ],
    [
      "Skipped link or special file: ",
      "Skipped link or special file: {path}",
      "path",
    ],
    [
      "Skipped link or special folder on ",
      "Skipped link or special folder on {disk}",
      "disk",
    ],
  ] as const)
    if (message.startsWith(prefix))
      return translate(key, { [parameter]: message.slice(prefix.length) });
  const warning =
    /^([A-Za-z0-9_-]+): (Moving and same-disk mux output need read-write access)$/.exec(
      message,
    );
  if (warning) return warning[1] + ": " + translate(warning[2]);
  return translate(message);
}

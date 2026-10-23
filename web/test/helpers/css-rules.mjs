// Small CSS block reader, shared by the ownership guard and release audit.
export function cssRules(source) {
  const out = [],
    stack = [];
  let start = 0,
    quote = "",
    comment = false;
  for (let i = 0; i < source.length; i++) {
    const c = source[i],
      next = source[i + 1];
    if (comment) {
      if (c === "*" && next === "/") {
        comment = false;
        i++;
      }
      continue;
    }
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
      continue;
    }
    if (c === "/" && next === "*") {
      comment = true;
      i++;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") {
      const header = source
        .slice(start, i)
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .trim();
      stack.push({
        header,
        start,
        open: i,
        context: stack.map((x) => x.header),
      });
      start = i + 1;
    } else if (c === "}") {
      const block = stack.pop();
      if (block && !block.header.startsWith("@"))
        out.push({
          ...block,
          body: source.slice(block.open + 1, i),
          end: i + 1,
        });
      start = i + 1;
    } else if (c === ";" && stack.length === 0) start = i + 1;
  }
  return out;
}
export function selectors(header) {
  const parts = [];
  let depth = 0,
    start = 0;
  for (let i = 0; i < header.length; i++) {
    if ("([".includes(header[i])) depth++;
    else if (")]".includes(header[i])) depth--;
    else if (header[i] === "," && !depth) {
      parts.push(header.slice(start, i).trim());
      start = i + 1;
    }
  }
  parts.push(header.slice(start).trim());
  return parts.filter(Boolean);
}

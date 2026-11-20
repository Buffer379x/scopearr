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
// Splits a rule body into { name, value } declarations; semicolons inside
// parentheses or strings do not end a declaration.
export function declarations(body) {
  const out = [];
  let depth = 0,
    quote = "",
    start = 0;
  const text = body.replace(/\/\*[\s\S]*?\*\//g, "");
  const push = (end) => {
    const part = text.slice(start, end).trim();
    if (!part) return;
    const colon = part.indexOf(":");
    out.push(
      colon < 0
        ? { name: part, value: "" }
        : {
            name: part.slice(0, colon).trim(),
            value: part.slice(colon + 1).trim(),
          },
    );
  };
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = "";
    } else if (c === '"' || c === "'") quote = c;
    else if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (c === ";" && !depth) {
      push(i);
      start = i + 1;
    }
  }
  push(text.length);
  return out;
}

// Every custom property definition with its rule selector and enclosing
// at-rules (joined by " "; "" at the top level).
export function customProperties(source) {
  return cssRules(source).flatMap((rule) =>
    declarations(rule.body)
      .filter((d) => d.name.startsWith("--"))
      .map(({ name, value }) => ({
        selector: rule.header,
        name,
        value,
        media: rule.context.join(" "),
      })),
  );
}

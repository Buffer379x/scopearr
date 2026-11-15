import type { ComponentChildren, JSX } from "preact";
import { useEffect, useRef } from "preact/hooks";

// A terminal's output (docs/STYLEGUIDE.md, Part 1, 10.9, Phase 5d E8;
// replaces the 1.7.0 TerminalOutput): a named, focusable code block that
// follows new text only while it is at its end (within 32px), so reading
// further up is never interrupted. With follow={false} (a script to read
// from its top) it stays where it is.
export function Terminal({
  label,
  text,
  follow: tail = true,
  children,
}: {
  label: string;
  text: string;
  follow?: boolean;
  children: ComponentChildren;
}): JSX.Element {
  const follow = useRef(true),
    pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (tail && follow.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [text, tail]);
  return (
    <pre
      ref={pre}
      class="v2-code"
      tabIndex={0}
      aria-label={label}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {children}
    </pre>
  );
}

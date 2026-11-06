import type { ComponentChildren } from "preact";
import { useEffect, useRef } from "preact/hooks";

export function TerminalOutput({
  text,
  children,
}: {
  text: string;
  children: ComponentChildren;
}) {
  const follow = useRef(true),
    pre = useRef<HTMLPreElement>(null);
  useEffect(() => {
    if (follow.current && pre.current)
      pre.current.scrollTop = pre.current.scrollHeight;
  }, [text]);
  return (
    <pre
      class="terminal"
      ref={pre}
      onScroll={(e) => {
        const el = e.currentTarget;
        follow.current = el.scrollHeight - el.scrollTop - el.clientHeight < 32;
      }}
    >
      {children}
    </pre>
  );
}

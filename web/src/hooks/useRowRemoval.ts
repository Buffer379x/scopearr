import { useRef, useState } from "preact/hooks";

// Only the chosen row fades. Failed requests restore it without disturbing the
// selection, scroll position or actions in the rest of the table.
export function useRowRemoval(changed: () => unknown) {
  const pending = useRef(new Set<number>());
  const [removing, setRemoving] = useState(new Set<number>());
  const [hidden, setHidden] = useState(new Set<number>());
  const remove = async (id: number, request: () => Promise<unknown>) => {
    if (pending.current.has(id)) return;
    pending.current.add(id);
    setRemoving((current) => new Set([...current, id]));
    const fade = setTimeout(
      () => setHidden((current) => new Set([...current, id])),
      window.matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 120,
    );
    try {
      await request();
      clearTimeout(fade);
      setHidden((current) => new Set([...current, id]));
      await Promise.resolve(changed()).catch(() => {});
    } catch {
      clearTimeout(fade);
      setHidden(
        (current) => new Set([...current].filter((value) => value !== id)),
      );
    } finally {
      pending.current.delete(id);
      setRemoving(
        (current) => new Set([...current].filter((value) => value !== id)),
      );
    }
  };
  return { removing, hidden, remove };
}

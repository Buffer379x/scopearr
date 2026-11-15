import { useEffect, useLayoutEffect, useRef, useState } from "preact/hooks";
import {
  answerConfirmation,
  currentConfirmation,
  subscribeConfirmation,
} from "../confirmation";
import { lazyChunk, useLazyChunk } from "../hooks/useLazyChunk";

// The confirmation dialog is a lazy chunk (Phase 5d, Task 5 fix round,
// like Tag rules in 5c): preloaded at idle after the first paint, so the
// first question does not wait; a question asked before it arrived shows
// with it. When it cannot load, the error notice “Scopearr is not
// reachable” shows and the question answers no, without a reload (the
// failure is handled on the import() itself, lazyChunk). The start set
// keeps only this host and confirmation.ts, which reads the element that
// asked when a question opens.
const confirmationChunk = lazyChunk(() =>
  import("./ConfirmationDialog").then(
    (module) => module?.ConfirmationDialog ?? null,
    () => null,
  ),
);

export function ConfirmationHost() {
  const [, refresh] = useState(0);
  useEffect(() => subscribeConfirmation(() => refresh((n) => n + 1)), []);
  const question = currentConfirmation();
  const Dialog = useLazyChunk(confirmationChunk, !!question, () =>
    answerConfirmation(false),
  );
  // While a question waits for the chunk (a press before the idle preload
  // arrived) no dialog shows yet, so the page is inert meanwhile. Once the
  // dialog is there, or the question ended, the page is live again and the
  // asking element gets its focus back (inert took it), before the dialog
  // reads it on open: so the release runs in the render, ahead of the
  // dialog's own layout effect.
  const held = useRef<(() => void) | null>(null);
  const waiting = !!question && !Dialog;
  if (!waiting) held.current?.();
  useLayoutEffect(() => {
    const app = globalThis.document?.getElementById("app");
    if (!waiting || !app) return;
    const opener = question?.opener;
    app.inert = true;
    const release = (held.current = () => {
      held.current = null;
      app.inert = false;
      if (opener?.isConnected) opener.focus();
    });
    return () => held.current === release && release();
  }, [waiting]);
  return Dialog ? <Dialog /> : null;
}

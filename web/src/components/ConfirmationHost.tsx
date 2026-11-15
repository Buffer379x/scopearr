import { useEffect, useState } from "preact/hooks";
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
  const Dialog = useLazyChunk(confirmationChunk, !!currentConfirmation(), () =>
    answerConfirmation(false),
  );
  return Dialog ? <Dialog /> : null;
}

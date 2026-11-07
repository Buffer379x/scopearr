// The rail flyout as a pure state machine: rail → peek (150ms) → open →
// closing (220ms) → rail. The delays are JavaScript constants (a documented
// exception to the token rule, docs/STYLEGUIDE.md 10.1).
//
// Inputs, sent by the sidebar:
// - enter/leave: a mouse or pen pointer enters or leaves a rail entry, or
//   leaves the flyout. Touch sends no pointer input.
// - flyoutenter: the pointer enters the flyout. Together with the close
//   delay this is the bridge across the gap between rail and flyout.
// - focus: visible keyboard focus lands on a rail entry.
// - press: a click or tap on a group trigger, or → / Enter on it. It always
//   opens and never closes (a click after a hover-open must not close).
// - timeout: the delay of the last result ran out.
// - dismiss: Escape, ←, Tab out, a click on an entry, resize, a mode or
//   route change, focus leaving rail and flyout.
//
// The flyout is visible in open and closing. Every result replaces the
// pending timer: wait > 0 starts one that sends timeout, 0 starts none.
// Moving between entries while open switches at once, with nothing closing
// in between; inputs that do not apply change nothing.

export const FLYOUT_OPEN_DELAY = 150,
  FLYOUT_CLOSE_DELAY = 220;
export type FlyoutState = {
  phase: "rail" | "peek" | "open" | "closing";
  item: string | null;
};
export type FlyoutInput =
  | { type: "enter"; item: string }
  | { type: "leave" }
  | { type: "flyoutenter" }
  | { type: "focus"; item: string }
  | { type: "press"; item: string }
  | { type: "timeout" }
  | { type: "dismiss" };
export const FLYOUT_RAIL: FlyoutState = Object.freeze({
  phase: "rail",
  item: null,
});

type Wait = 0 | typeof FLYOUT_OPEN_DELAY | typeof FLYOUT_CLOSE_DELAY;

export function flyoutNext(
  state: FlyoutState,
  input: FlyoutInput,
): { state: FlyoutState; wait: 0 | 150 | 220 } {
  const { phase, item } = state;
  // An unchanged state comes back as the same object, so a consumer does
  // not render again.
  const to = (
    next: FlyoutState["phase"],
    nextItem: string | null,
    wait: Wait = 0,
  ) => ({
    state:
      next === phase && nextItem === item
        ? state
        : { phase: next, item: nextItem },
    wait,
  });
  const visible = phase === "open" || phase === "closing";
  switch (input.type) {
    case "dismiss":
      return to("rail", null);
    case "focus":
    case "press":
      return to("open", input.item);
    case "enter":
      return visible
        ? to("open", input.item)
        : to("peek", input.item, FLYOUT_OPEN_DELAY);
    case "flyoutenter":
      // Only a visible flyout can be entered; a peek keeps its delay.
      return visible
        ? to("open", item)
        : phase === "peek"
          ? to("peek", item, FLYOUT_OPEN_DELAY)
          : to("rail", null);
    case "leave":
      return visible
        ? to("closing", item, FLYOUT_CLOSE_DELAY)
        : to("rail", null);
    case "timeout":
      return phase === "peek"
        ? to("open", item)
        : phase === "closing"
          ? to("rail", null)
          : to(phase, item);
  }
}

// Runs the machine on timers: every result replaces the pending timer, and
// `changed` hears each new state once. stop() drops the pending timer
// (unmount).
export function createFlyout(
  changed: (state: FlyoutState) => void,
  timers: Pick<typeof globalThis, "setTimeout" | "clearTimeout"> = globalThis,
): { send(input: FlyoutInput): void; state(): FlyoutState; stop(): void } {
  const { setTimeout: start, clearTimeout: clear } = timers;
  let state = FLYOUT_RAIL,
    timer: ReturnType<typeof setTimeout> | undefined;
  const stop = () => {
    if (timer !== undefined) clear(timer);
    timer = undefined;
  };
  const send = (input: FlyoutInput) => {
    const next = flyoutNext(state, input);
    stop();
    if (next.wait)
      timer = start(() => {
        timer = undefined;
        send({ type: "timeout" });
      }, next.wait);
    if (next.state !== state) {
      state = next.state;
      changed(state);
    }
  };
  return { send, state: () => state, stop };
}

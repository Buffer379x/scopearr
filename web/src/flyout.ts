// The rail flyout as a pure state machine: rail → peek (150ms) → open →
// closing (220ms) → rail. The delays are JavaScript constants (a documented
// exception to the token rule, docs/STYLEGUIDE.md 10.1).
//
// Inputs, sent by the sidebar:
// - enter/leave: a mouse or pen pointer enters or leaves a rail entry, or
//   leaves the flyout. Touch sends no pointer input.
// - flyoutenter: the pointer enters the flyout. Together with the close
//   delay this is the bridge across the gap between rail and flyout.
// - focus: visible keyboard focus lands on a rail entry. blur: focus leaves
//   a rail entry.
// - focusin/focusout: focus moves into or out of the flyout.
// - press: a click or tap on a group trigger, or → / Enter on it. It always
//   opens and never closes (a click after a hover-open must not close).
// - timeout: the delay of the last result ran out.
// - dismiss: Escape, ←, Tab out, a click on an entry, resize, a mode or
//   route change, focus leaving rail and flyout.
//
// Besides phase and item the state remembers two things (C+ app.js
// flySuppress and the focus check before closing):
// - suppressed: the item a dismiss closed. Focus or the pointer on it do
//   not open it again, so focus returning to the rail entry after Escape or
//   ← leaves the flyout closed. leave, blur and another item end it; a
//   press opens it anyway.
// - inside: focus is in the flyout. Then a pointer leave starts no close
//   timer and a timeout closes nothing, so the focused entry stays. focusout
//   continues the close with the full delay. Another item's content and
//   dismiss clear it.
//
// The flyout is visible in open and closing. Every result sets the timer:
// wait > 0 replaces the pending timer with one that sends timeout, 0 stops
// it, and null keeps it. Inputs that do not apply return the same state and
// null, so a peek keeps its delay; a new enter starts the intent again, as
// in C+ (flyArm). Moving between entries while open switches at once, with
// nothing closing in between.

export const FLYOUT_OPEN_DELAY = 150,
  FLYOUT_CLOSE_DELAY = 220;
export type FlyoutState = {
  phase: "rail" | "peek" | "open" | "closing";
  item: string | null;
  suppressed: string | null;
  inside: boolean;
};
export type FlyoutInput =
  | { type: "enter"; item: string }
  | { type: "leave" }
  | { type: "flyoutenter" }
  | { type: "focus"; item: string }
  | { type: "blur" }
  | { type: "focusin" }
  | { type: "focusout" }
  | { type: "press"; item: string }
  | { type: "timeout" }
  | { type: "dismiss" };
export const FLYOUT_RAIL: FlyoutState = Object.freeze({
  phase: "rail",
  item: null,
  suppressed: null,
  inside: false,
});

type Wait = 0 | typeof FLYOUT_OPEN_DELAY | typeof FLYOUT_CLOSE_DELAY | null;

export function flyoutNext(
  state: FlyoutState,
  input: FlyoutInput,
): { state: FlyoutState; wait: 0 | 150 | 220 | null } {
  const { phase, item, suppressed, inside } = state;
  const visible = phase === "open" || phase === "closing";
  // An unchanged state comes back as the same object, so a consumer does
  // not render again.
  const to = (change: Partial<FlyoutState>, wait: Wait) => {
    const next = { ...state, ...change };
    return {
      state:
        next.phase === phase &&
        next.item === item &&
        next.suppressed === suppressed &&
        next.inside === inside
          ? state
          : next,
      wait,
    };
  };
  const keep = { state, wait: null };
  // Showing an item ends any suppression; focus in another item's content
  // does not count.
  const show = (next: "peek" | "open", target: string, wait: Wait) =>
    to(
      {
        phase: next,
        item: target,
        suppressed: null,
        inside: target === item && inside,
      },
      wait,
    );
  switch (input.type) {
    case "dismiss":
      return to(
        {
          phase: "rail",
          item: null,
          suppressed: item ?? suppressed,
          inside: false,
        },
        0,
      );
    case "press":
      return show("open", input.item, 0);
    case "focus":
      return input.item === suppressed ? keep : show("open", input.item, 0);
    case "enter":
      return input.item === suppressed
        ? keep
        : visible
          ? show("open", input.item, 0)
          : show("peek", input.item, FLYOUT_OPEN_DELAY);
    case "flyoutenter":
      return phase === "closing" ? to({ phase: "open" }, 0) : keep;
    case "leave":
      return visible
        ? to(
            { phase: "closing", suppressed: null },
            inside ? 0 : FLYOUT_CLOSE_DELAY,
          )
        : phase === "peek"
          ? to({ phase: "rail", item: null, suppressed: null }, 0)
          : suppressed
            ? to({ suppressed: null }, null)
            : keep;
    case "blur":
      return suppressed ? to({ suppressed: null }, null) : keep;
    case "focusin":
      return visible && !inside ? to({ inside: true }, 0) : keep;
    case "focusout":
      return inside
        ? to({ inside: false }, phase === "closing" ? FLYOUT_CLOSE_DELAY : null)
        : keep;
    case "timeout":
      return phase === "peek"
        ? to({ phase: "open" }, 0)
        : phase === "closing" && !inside
          ? to({ phase: "rail", item: null }, 0)
          : keep;
  }
}

// Runs the machine on timers as each result says, and `changed` hears each
// new state once. stop() drops the pending timer (unmount).
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
    if (next.wait !== null) {
      stop();
      if (next.wait)
        timer = start(() => {
          timer = undefined;
          send({ type: "timeout" });
        }, next.wait);
    }
    if (next.state !== state) {
      state = next.state;
      changed(state);
    }
  };
  return { send, state: () => state, stop };
}

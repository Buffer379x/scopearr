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
// - dismiss: closes. With back (←, Escape, a click on an entry) it also
//   suppresses the item; without (Tab out, an outside click, resize, a mode
//   or route change, focus leaving rail and flyout) it does not.
//
// Besides phase and item the state remembers three things (C+ app.js
// flySuppress and the check before closing, app.js:643):
// - suppressed: the item a step back closed. Focus or the pointer on it do
//   not open it again, so focus returning to the rail entry after Escape or
//   ← leaves the flyout closed. leave, blur and another item end it; a
//   press opens it anyway. Another dismiss keeps it.
// - inside: focus is in the flyout. Another item's content and dismiss
//   clear it.
// - focused: the rail entry with visible keyboard focus, noted by focus and
//   cleared by blur, a press and focus moving into the flyout.
// While focus is inside, or the shown item's own entry is focused, the
// flyout holds: a pointer leave starts no close timer and a timeout closes
// nothing. When the hold ends (focusout, blur), a closing flyout closes
// after the full delay; focus coming back to its entry holds it again.
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
  focused: string | null;
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
  | { type: "dismiss"; back?: boolean };
export const FLYOUT_RAIL: FlyoutState = Object.freeze({
  phase: "rail",
  item: null,
  suppressed: null,
  inside: false,
  focused: null,
});

type Wait = 0 | typeof FLYOUT_OPEN_DELAY | typeof FLYOUT_CLOSE_DELAY | null;

// Focus in the flyout, or on the shown item's own rail entry.
const holds = (state: FlyoutState) =>
  state.inside || (state.focused !== null && state.focused === state.item);

export function flyoutNext(
  state: FlyoutState,
  input: FlyoutInput,
): { state: FlyoutState; wait: 0 | 150 | 220 | null } {
  const { phase, item, suppressed, inside, focused } = state;
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
        next.inside === inside &&
        next.focused === focused
          ? state
          : next,
      wait,
    };
  };
  const keep = { state, wait: null };
  // Focus leaves the flyout or the entry: a closing flyout whose hold ends
  // closes after the full delay.
  const release = (change: Partial<FlyoutState>) =>
    to(
      change,
      phase === "closing" && holds(state) && !holds({ ...state, ...change })
        ? FLYOUT_CLOSE_DELAY
        : null,
    );
  // Showing an item ends any suppression; focus in another item's content
  // does not count.
  const show = (
    next: "peek" | "open",
    target: string,
    wait: Wait,
    change: Partial<FlyoutState> = {},
  ) =>
    to(
      {
        phase: next,
        item: target,
        suppressed: null,
        inside: target === item && inside,
        ...change,
      },
      wait,
    );
  switch (input.type) {
    case "dismiss":
      return to(
        {
          phase: "rail",
          item: null,
          suppressed: input.back ? (item ?? suppressed) : suppressed,
          inside: false,
        },
        0,
      );
    case "press":
      return show("open", input.item, 0, { focused: null });
    case "focus":
      // Focus is on a rail entry now, not in the flyout. A suppressed entry
      // stays closed; the shown entry of a closing flyout holds it again
      // (the pointer is still outside).
      return input.item === suppressed
        ? to({ focused: input.item, inside: false }, null)
        : phase === "closing" && input.item === item
          ? to({ focused: input.item, inside: false }, 0)
          : show("open", input.item, 0, { focused: input.item, inside: false });
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
            holds(state) ? 0 : FLYOUT_CLOSE_DELAY,
          )
        : phase === "peek"
          ? to({ phase: "rail", item: null, suppressed: null }, 0)
          : suppressed
            ? to({ suppressed: null }, null)
            : keep;
    case "blur":
      return suppressed || focused !== null
        ? release({ suppressed: null, focused: null })
        : keep;
    case "focusin":
      return visible && !inside ? to({ inside: true, focused: null }, 0) : keep;
    case "focusout":
      return inside ? release({ inside: false }) : keep;
    case "timeout":
      return phase === "peek"
        ? to({ phase: "open" }, 0)
        : phase === "closing" && !holds(state)
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

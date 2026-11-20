import type { ComponentChildren, JSX } from "preact";

// A field (docs/STYLEGUIDE.md, Part 1, 10.4 and 10.11): div.v2-field with
// its label (for the control's id), the control and its hint as small,
// named by the control's aria-describedby. A helper, not a component, so
// the caller's tree holds the field itself; `more` stands between the
// control and the hint, `help` (a HelpTip) beside the label in
// span.v2-field-head, outside the label, so it names nothing. With `aria`
// the field has no visible label: the control is named by aria-label (a
// card's single control, named like its card) and gets no id.
export type FieldParts = {
  hint?: ComponentChildren;
  key?: string;
  more?: ComponentChildren;
  help?: ComponentChildren;
  aria?: boolean;
};

export function field(
  id: string,
  label: ComponentChildren,
  control: (a: {
    id?: string;
    "aria-label"?: string;
    "aria-describedby"?: string;
  }) => JSX.Element,
  { hint, key, more, help, aria }: FieldParts = {},
): JSX.Element {
  const describedby = hint ? id + "-hint" : undefined;
  if (aria)
    return (
      <div class="v2-field" key={key}>
        {control({
          "aria-label": String(label),
          "aria-describedby": describedby,
        })}
        {more}
        {hint && <small id={id + "-hint"}>{hint}</small>}
      </div>
    );
  const name = <label for={id}>{label}</label>;
  return (
    <div class="v2-field" key={key}>
      {help ? (
        <span class="v2-field-head">
          {name}
          {help}
        </span>
      ) : (
        name
      )}
      {control({ id, "aria-describedby": describedby })}
      {more}
      {hint && <small id={id + "-hint"}>{hint}</small>}
    </div>
  );
}

// A field of several controls (checkboxes and their hint) in one
// div.v2-field, with no single control to label.
export function fieldGroup(children: ComponentChildren): JSX.Element {
  return <div class="v2-field">{children}</div>;
}

import test from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { componentHarness, nodes, text } from "./helpers/component-harness.mjs";
import { src } from "./helpers/sources.mjs";

// Sign-in, setup and the loading screen (docs/STYLEGUIDE.md, Part 1, 11.5):
// one Login component for both, every 1.7.0 function kept, the password
// toggle of the approved design (ruling R-A) and the icon with the 2.0.0
// cache key. The harness renders the real component; LanguageSelect is a
// named stand-in, the API an explicit fake.

const t = (key, values = {}) =>
  key.replace(/\{(\w+)\}/g, (_, name) => values[name] ?? "");

function login(status = {}, { expired = false, answer } = {}) {
  const calls = [],
    finished = [];
  const harness = componentHarness(
    "Login",
    {
      status: { version: "2.0.0", initialized: true, demo: false, ...status },
      done: async () => {
        finished.push(true);
      },
      expired,
    },
    {
      modules: {
        "../api": {
          api: (...args) => {
            calls.push(args);
            return answer ? answer() : Promise.resolve({ ok: true });
          },
        },
        "../i18n": {
          useI18n: () => ({ locale: "en" }),
          t,
          LanguageSelect: "LanguageSelect",
        },
      },
    },
  );
  return { harness, calls, finished };
}

const classes = (node) =>
  typeof node?.props?.class === "string" ? node.props.class.split(" ") : [];
const byClass = (tree, name) =>
  nodes(tree).find((node) => classes(node).includes(name));
const byId = (tree, id) => nodes(tree).find((node) => node.props?.id === id);
const inputs = (tree) => nodes(tree).filter((node) => node.type === "input");
const toggle = (tree) =>
  nodes(tree).find(
    (node) => node.type === "button" && node.props.type === "button",
  );
const submitButton = (tree) =>
  nodes(tree).find(
    (node) => node.type === "button" && node.props.type === "submit",
  );
const form = (tree) => nodes(tree).find((node) => node.type === "form");
const labelOf = (tree, id) =>
  nodes(tree).find((node) => node.type === "label" && node.props.for === id);
const hintsOf = (tree, input) =>
  (input.props["aria-describedby"] ?? "")
    .split(" ")
    .filter(Boolean)
    .map((id) => text(byId(tree, id)));
// The calls in plain objects: the component runs in its own context.
const plain = (value) => JSON.parse(JSON.stringify(value));
const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
};

test("login keeps every 1.7.0 function", async () => {
  // Signed out on an initialized instance: username and password with their
  // autocomplete, the language choice in the card head, the footer with
  // its space.
  const signIn = login().harness.render();
  assert.equal(signIn.type, "main");
  const [user, password] = inputs(signIn);
  assert.equal(inputs(signIn).length, 2);
  assert.equal(text(labelOf(signIn, user.props.id)), "Username");
  assert.equal(user.props.autoComplete, "username");
  assert.equal(user.props.required, true);
  assert.equal(user.props.value, "");
  assert.equal(text(labelOf(signIn, password.props.id)), "Password");
  assert.equal(password.props.type, "password");
  assert.equal(password.props.autoComplete, "current-password");
  assert.equal(password.props.required, true);
  assert.equal(password.props.minLength, undefined);
  assert.deepEqual(hintsOf(signIn, password), []);
  const head = byClass(signIn, "v2-login-head");
  assert.equal(
    text(nodes(head).find((node) => node.type === "h2")),
    "Welcome back.",
  );
  assert.ok(
    nodes(head).some((node) => node.type === "LanguageSelect"),
    "the language choice sits in the card head",
  );
  const order = nodes(form(signIn));
  assert.ok(
    order.findIndex((node) => node.type === "LanguageSelect") <
      order.indexOf(user),
    "the language choice comes before the fields",
  );
  assert.match(text(signIn), /Sign in to explore your library\./);
  assert.ok(
    text(signIn).includes("Scopearr 2.0.0 · For your own server"),
    text(signIn),
  );
  assert.equal(text(submitButton(signIn)).trim(), "Sign in");
  assert.equal(submitButton(signIn).props.disabled, false);
  assert.equal(byClass(signIn, "v2-notice"), undefined);

  // Setup: the setup code with its hint first, then username and a new
  // password of at least 12 characters with its hint.
  const setup = login({ initialized: false }).harness.render();
  const [token, setupUser, newPassword] = inputs(setup);
  assert.equal(inputs(setup).length, 3);
  assert.equal(text(labelOf(setup, token.props.id)), "Setup code");
  assert.equal(token.props.autoComplete, "off");
  assert.equal(token.props.required, true);
  assert.deepEqual(hintsOf(setup, token), [
    "Copy the one-time code from /data/setup-token in the container console.",
  ]);
  assert.equal(setupUser.props.autoComplete, "username");
  assert.equal(newPassword.props.autoComplete, "new-password");
  assert.equal(newPassword.props.minLength, 12);
  assert.equal(newPassword.props.required, true);
  assert.deepEqual(hintsOf(setup, newPassword), [
    "At least 12 characters, at most 72 UTF-8 bytes.",
  ]);
  assert.match(text(setup), /Your library starts here\./);
  assert.match(
    text(setup),
    /Create your local admin account, then connect your services\./,
  );
  assert.equal(text(submitButton(setup)).trim(), "Create account");
  assert.ok(text(setup).includes("Scopearr 2.0.0 · For your own server"));

  // The demo fills in its credentials and says so.
  const demo = login({ demo: true }).harness.render();
  assert.equal(inputs(demo)[0].props.value, "demo");
  assert.equal(inputs(demo)[1].props.value, "Scopearr-demo-2026");
  assert.equal(
    text(byClass(demo, "v2-notice")),
    "Interactive demo with sample data. Credentials are prefilled.",
  );

  // An expired session is announced as a status.
  const expired = login({}, { expired: true }).harness.render();
  const notice = nodes(expired).find((node) => node.props?.role === "status");
  assert.equal(text(notice), "Your session expired. Sign in again.");
  assert.ok(classes(notice).includes("v2-notice"));

  // Sign in: the same request as 1.7.0; busy locks the button until it ends,
  // then done() runs.
  const answer = deferred();
  const run = login({}, { answer: () => answer.promise });
  let tree = run.harness.render();
  inputs(tree)[0].props.onInput({ currentTarget: { value: "admin" } });
  inputs(run.harness.render())[1].props.onInput({
    currentTarget: { value: "a-long-password" },
  });
  let prevented = false;
  const pending = form(run.harness.render()).props.onSubmit({
    preventDefault: () => (prevented = true),
  });
  assert.equal(prevented, true);
  assert.deepEqual(plain(run.calls), [
    [
      "login",
      "POST",
      { username: "admin", password: "a-long-password", token: "" },
    ],
  ]);
  tree = run.harness.render();
  assert.equal(submitButton(tree).props.disabled, true);
  assert.ok(byClass(submitButton(tree), "v2-spin"), "busy shows a spinner");
  answer.resolve({ ok: true });
  await pending;
  assert.deepEqual(run.finished, [true]);
  assert.equal(submitButton(run.harness.render()).props.disabled, false);

  // A failed request (its message is the API's toast) unlocks the button
  // and stays on the page.
  const failing = deferred();
  const failed = login({}, { answer: () => failing.promise });
  const attempt = form(failed.harness.render()).props.onSubmit({
    preventDefault() {},
  });
  assert.equal(submitButton(failed.harness.render()).props.disabled, true);
  failing.reject(new Error("Login failed or temporarily locked"));
  await attempt;
  assert.deepEqual(failed.finished, []);
  assert.equal(submitButton(failed.harness.render()).props.disabled, false);

  // Setup posts the setup code too.
  const created = login({ initialized: false });
  inputs(created.harness.render())[0].props.onInput({
    currentTarget: { value: "code-123" },
  });
  await form(created.harness.render()).props.onSubmit({ preventDefault() {} });
  assert.deepEqual(plain(created.calls), [
    ["setup", "POST", { username: "", password: "", token: "code-123" }],
  ]);
});

test("login and setup share one component", () => {
  // main.tsx renders Login for both; there is no separate setup screen.
  const main = src("main.tsx");
  assert.match(main, /import \{ Login \} from "\.\/components\/Login";/);
  assert.equal(main.match(/<Login\b/g).length, 1);
  for (const name of ["Setup", "SetupScreen", "SignIn"])
    assert.ok(
      !existsSync(new URL(`../src/components/${name}.tsx`, import.meta.url)),
      name,
    );

  const signIn = login().harness.render();
  const setup = login({ initialized: false }).harness.render();
  // The same page: band, card and footer; setup adds its code field first.
  const frame = (tree) => [
    tree.props.class,
    byClass(tree, "v2-login-band").props.class,
    form(tree).props.class,
    byClass(tree, "v2-login-head").props.class,
    byClass(tree, "v2-login-foot").props.class,
    text(byClass(tree, "v2-login-band")),
  ];
  assert.deepEqual(frame(setup), frame(signIn));
  assert.deepEqual(
    inputs(signIn).map((input) => input.props.id),
    ["v2-login-user", "v2-login-password"],
  );
  assert.deepEqual(
    inputs(setup).map((input) => input.props.id),
    ["v2-login-token", "v2-login-user", "v2-login-password"],
  );
});

test("the band shows the app icon with the 2.0.0 cache key", () => {
  const tree = login().harness.render();
  const band = byClass(tree, "v2-login-band");
  const icon = nodes(band).find((node) => node.type === "img");
  assert.equal(icon.props.src, "/icon.svg?v=2.0.0");
  assert.equal(icon.props.alt, "Scopearr icon");
  // Its box is known before the image loads, so nothing moves.
  assert.equal(icon.props.width, 72);
  assert.equal(icon.props.height, 72);
  assert.equal(
    text(nodes(band).find((node) => node.type === "h1")),
    "Scopearr",
  );
  assert.equal(
    text(nodes(band).find((node) => node.type === "p")),
    "Your movie and TV library. Clearly filtered.",
  );
  // No 1.7.0 PNG icon (a day in the browser cache) on either screen.
  for (const file of ["components/Login.tsx", "components/LoadingScreen.tsx"])
    assert.doesNotMatch(src(file), /\/icon-\d+\.png|srcSet/, file);
});

test("the password toggle shows and hides the password in place", () => {
  for (const initialized of [true, false]) {
    const { harness } = login({ initialized, demo: true });
    let tree = harness.render();
    const field = (tree) =>
      inputs(tree).find((input) => input.props.id === "v2-login-password");
    let button = toggle(tree);
    assert.equal(field(tree).props.type, "password");
    assert.equal(button.props["aria-label"], "Show password");
    assert.equal(button.props.title, "Show password");
    assert.equal(button.props["aria-pressed"], false);
    assert.equal(button.props["aria-controls"], "v2-login-password");
    // Its eye (eye-off while pressed) is drawn by the v2-reveal recipe.
    assert.ok(classes(button).includes("v2-reveal"));
    assert.equal(button.props.children, undefined);
    // It sits in the password's group, right after the field.
    const group = nodes(tree).find(
      (node) =>
        classes(node).includes("v2-input-group") &&
        nodes(node).includes(button),
    );
    assert.deepEqual(
      nodes(group)
        .filter((node) => node.type === "input" || node.type === "button")
        .map((node) => node.type),
      ["input", "button"],
    );
    // A press keeps focus (and the caret) in the field.
    let pressed = false;
    button.props.onMouseDown({ preventDefault: () => (pressed = true) });
    assert.equal(pressed, true, "a press does not take focus from the field");

    button.props.onClick();
    tree = harness.render();
    button = toggle(tree);
    assert.equal(field(tree).props.type, "text");
    assert.equal(field(tree).props.value, "Scopearr-demo-2026");
    assert.equal(
      field(tree).props.autoComplete,
      initialized ? "current-password" : "new-password",
    );
    assert.equal(button.props["aria-label"], "Hide password");
    assert.equal(button.props.title, "Hide password");
    assert.equal(button.props["aria-pressed"], true);

    button.props.onClick();
    tree = harness.render();
    assert.equal(field(tree).props.type, "password");
    assert.equal(toggle(tree).props["aria-pressed"], false);
    assert.equal(toggle(tree).props["aria-label"], "Show password");
  }
});

test("the loading screen shows the icon, a spinner and its message", () => {
  const screen = (props) =>
    componentHarness("LoadingScreen", props, {
      modules: { "../i18n": { t } },
    }).render();
  const tree = screen({});
  assert.ok(classes(tree).includes("v2-loading"));
  const icon = nodes(tree).find((node) => node.type === "img");
  assert.equal(icon.props.src, "/icon.svg?v=2.0.0");
  assert.equal(icon.props.alt, "");
  assert.equal(icon.props.width, 72);
  assert.equal(icon.props.height, 72);
  assert.ok(byClass(tree, "v2-spin"), "a spinner");
  assert.equal(text(tree), "Loading Scopearr …");
  assert.equal(
    text(screen({ message: "Scopearr is not reachable" })),
    "Scopearr is not reachable",
  );
});

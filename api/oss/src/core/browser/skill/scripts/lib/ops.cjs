"use strict";

// The commands the agent runs on the active tab, and the error each failure shows the agent.

const {
  ACTION_TIMEOUT_MS,
  MAX_TEXT_CHARS,
  NAVIGATION_TIMEOUT_MS,
} = require("./config.cjs");
const { requireIntent, restoreRefs } = require("./guard.cjs");
const {
  INTERACTIVE_ROLES,
  capped,
  changesSince,
  enclosingItem,
  itemBlock,
  outline,
  pageHeader,
  pageView,
  settle,
  snapshotLines,
  snapshotText,
} = require("./page-text.cjs");

const MAX_FIND_MATCHES = 20;

const fail = (code, message, extra) =>
  Object.assign(new Error(message), { code, ...extra });

function agentError(code, message, { next_step } = {}) {
  return { ok: false, error: { code, message, ...(next_step ? { next_step } : {}) } };
}

// The message only: the agent reads it, and a stack trace would leak internals.
function errorText(e) {
  const message = e instanceof Error ? e.message : typeof e === "string" ? e : "";
  return (message || "Unexpected error.").split("\n")[0].slice(0, 300);
}

function navigationAllowed(rawUrl) {
  if (rawUrl === "about:blank") return true;
  try {
    return ["http:", "https:"].includes(new URL(rawUrl).protocol);
  } catch {
    return false;
  }
}

function withScheme(raw) {
  const target = String(raw || "").trim();
  return /^[a-z]+:/i.test(target) ? target : `https://${target}`;
}

function refLocator(page, ref) {
  const match = String(ref || "")
    .trim()
    .match(/^(?:ref[_=])?\[?(?:ref=)?([a-z0-9]+)\]?$/i);
  if (!match) return null;
  return page.locator(`aria-ref=${match[1]}`);
}

let targetSeq = 0;

// Pin the element: an aria-ref resolves against the latest page snapshot, which reading a
// control's label replaces, and a role locator re-resolves to look-alikes after a click.
// The mark is found in the element's own frame: consent, payment and sign-in widgets live in iframes.
async function pin(page, locator) {
  const id = `t${++targetSeq}`;
  const handle = await locator.elementHandle({ timeout: ACTION_TIMEOUT_MS });
  try {
    await handle.evaluate((el, value) => el.setAttribute("data-agenta-target", value), id);
    const frame = (await handle.ownerFrame()) || page.mainFrame();
    return frame.locator(`[data-agenta-target="${id}"]`);
  } finally {
    await handle.dispose();
  }
}

async function resolveRef(page, ref) {
  const locator = refLocator(page, ref);
  if (!locator) throw fail("invalid_arguments", "bad ref");
  if ((await locator.count().catch(() => 0)) === 0)
    throw fail("element_not_found", "no element");
  return pin(page, locator);
}

async function roleCandidates(page, role, name) {
  const lines = (await snapshotText(page))
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l.startsWith(`- ${role} `) || l === `- ${role}`);
  const named = lines.filter(
    (l) => !name || l.toLowerCase().includes(name.toLowerCase()),
  );
  const pick = named.length ? named : lines;
  const shown = pick.slice(0, 15).join("\n");
  return pick.length > 15 ? `${shown}\n[${pick.length - 15} more]` : shown;
}

// Acts on exactly one element: a ref, or a role and name. Never guesses between several.
async function resolveTarget(page, { ref, role, name }) {
  if (ref) return resolveRef(page, ref);
  if (!role) throw fail("invalid_arguments", "Pass a ref, or a role and a name.");
  const locator = page.getByRole(String(role), name ? { name: String(name) } : {});
  const count = await locator.count().catch((e) => {
    throw fail("invalid_arguments", errorText(e));
  });
  if (count === 1) return pin(page, locator);
  const candidates = await roleCandidates(page, String(role), name ? String(name) : "");
  throw fail(count ? "ambiguous_target" : "element_not_found", candidates, { count });
}

const targetName = ({ ref, role, name }) => ref || (name ? `${role} "${name}"` : role);

// Passwords and one-time codes come from the person, in the live view, never from the agent.
async function refuseSecretField(locator) {
  const secret = await locator
    .evaluate(
      (el) =>
        el instanceof HTMLInputElement &&
        (el.type === "password" || /one-time-code/.test(el.autocomplete || "")),
    )
    .catch(() => false);
  if (secret) throw fail("secret_field", "secret field");
}

const OPS = {
  async navigate(page, { url, newTab }) {
    if (newTab && (url === "back" || url === "forward"))
      throw fail("invalid_arguments", "A new tab has no history. Pass a url.");
    if (url === "back") await page.goBack({ timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    else if (url === "forward")
      await page.goForward({ timeout: NAVIGATION_TIMEOUT_MS }).catch(() => {});
    else {
      if (!String(url || "").trim()) throw fail("invalid_arguments", "url is required");
      const target = withScheme(url);
      if (!navigationAllowed(target)) throw fail("site_not_allowed", target);
      try {
        await page.goto(target, { waitUntil: "domcontentloaded", timeout: NAVIGATION_TIMEOUT_MS });
      } catch (e) {
        if (/Timeout .*exceeded/.test(e.message)) {
          // A slow page that already opened is still a result: return what has loaded.
          if (page.url() !== "about:blank" && navigationAllowed(page.url()))
            return `[The page did not finish loading in ${NAVIGATION_TIMEOUT_MS / 1000} s. This is what has loaded.]\n${await pageView(page)}`;
          throw fail("page_timeout", target);
        }
        // The site moved on by itself (a script redirect): fine when the page it landed on is allowed.
        if (!/interrupted by another navigation/.test(e.message) || !navigationAllowed(page.url()))
          throw e;
      }
    }
    await page.waitForLoadState("load", { timeout: 5_000 }).catch(() => {});
    // Many sites fill the page from their own API after load; give that a moment, and say so if it is still going.
    const quiet = await page
      .waitForLoadState("networkidle", { timeout: 4_000 })
      .then(() => true, () => false);
    const view = await pageView(page);
    return quiet ? view : `[The page may still be loading. If something you expect is missing, run read again.]\n${view}`;
  },

  async read_page(page, { filter, ref }) {
    let raw;
    if (ref) {
      const part = await resolveRef(page, ref);
      raw = await part.ariaSnapshot({ mode: "ai", timeout: ACTION_TIMEOUT_MS }).finally(() => restoreRefs(page));
    } else raw = await snapshotText(page);
    const text =
      filter === "interactive"
        ? raw
            .split("\n")
            .filter((line) => INTERACTIVE_ROLES.test(line) || /\[cursor=pointer\]/.test(line))
            .join("\n")
        : raw;
    const header = await pageHeader(page);
    if (text.length <= MAX_TEXT_CHARS) return `${header}\n${text}`;
    return `${header}\n${outline(text.split("\n"), text.length)}`;
  },

  async find(page, { query }) {
    const needle = String(query || "").trim().toLowerCase();
    if (!needle) throw fail("invalid_arguments", "query is required");
    const lines = (await snapshotText(page)).split("\n");
    const starts = new Set();
    lines.forEach((line, i) => {
      if (line.toLowerCase().includes(needle)) starts.add(enclosingItem(lines, i));
    });
    const blocks = [...starts].slice(0, MAX_FIND_MATCHES).map((i) => itemBlock(lines, i));
    return capped(
      `${await pageHeader(page)}\n${blocks.length ? blocks.join("\n---\n") : `No element matches "${query}".`}` +
        (starts.size > MAX_FIND_MATCHES
          ? `\n[${starts.size - MAX_FIND_MATCHES} more matches; use a longer query.]`
          : ""),
    );
  },

  async click(page, args) {
    const locator = await resolveTarget(page, args);
    await requireIntent(locator, args.intent, "click");
    const before = await snapshotLines(page);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    await settle(page);
    return changesSince(page, before, `Clicked ${targetName(args)}.`, { mayNavigate: true });
  },

  async type(page, args) {
    const { text, submit } = args;
    // Keys that submit or move focus would act past the pay and delete check; `submit` presses Enter.
    if (/[\r\n\t]/.test(String(text ?? "")))
      throw fail("invalid_arguments", "Text cannot hold Enter or Tab; use --submit.");
    const locator = await resolveTarget(page, args);
    // Typing clicks the target first: only a field may be typed into.
    const editable = await locator.isEditable({ timeout: ACTION_TIMEOUT_MS }).catch(() => false);
    if (!editable) throw fail("invalid_arguments", "That element is not a text field.");
    await refuseSecretField(locator);
    if (submit) await requireIntent(locator, args.intent, "submit");
    const before = await snapshotLines(page);
    await locator.click({ timeout: ACTION_TIMEOUT_MS });
    // Type over the selection, as a person does: clearing first re-renders some inputs and the keys go astray.
    await locator.press("ControlOrMeta+a", { timeout: ACTION_TIMEOUT_MS });
    await locator.pressSequentially(String(text ?? ""), { delay: 15, timeout: ACTION_TIMEOUT_MS * 3 });
    if (submit) {
      await locator.press("Enter", { timeout: ACTION_TIMEOUT_MS });
      await settle(page);
    }
    await page.waitForTimeout(300);
    return changesSince(
      page,
      before,
      `Typed into ${targetName(args)}${submit ? " and pressed Enter" : ""}.`,
      { mayNavigate: Boolean(submit) },
    );
  },

  async form_input(page, args) {
    const { value } = args;
    const locator = await resolveTarget(page, args);
    await refuseSecretField(locator);
    await requireIntent(locator, args.intent, "set");
    const before = await snapshotLines(page);
    const kind = await locator.evaluate((el) =>
      el.tagName === "SELECT"
        ? "select"
        : el.type === "checkbox" || el.type === "radio" || el.getAttribute("role") === "switch"
          ? "check"
          : "fill",
    );
    if (kind === "select") await locator.selectOption(String(value), { timeout: ACTION_TIMEOUT_MS });
    else if (kind === "check")
      await locator.setChecked(value === true || value === "true", { timeout: ACTION_TIMEOUT_MS });
    else await locator.fill(String(value ?? ""), { timeout: ACTION_TIMEOUT_MS });
    return changesSince(page, before, `Set ${targetName(args)}.`);
  },
};

function opError(e) {
  if (e.code === "needs_approval") {
    const what = e.message === "pay" ? "pays or orders" : "deletes or removes";
    const thing = e.action === "submit" ? "form" : "control";
    return agentError("needs_approval", `That ${thing} looks like it ${what} something. Nothing was done.`, {
      next_step: `Ask the person first. Only after they say yes, run the same command again with --intent ${e.message}.`,
    });
  }
  if (e.code === "secret_field")
    return agentError("secret_field", "That is a password or one-time-code field. Nothing was typed.", {
      next_step: 'Run `agenta-browser wait "<why>"` and ask the person to sign in in the live view.',
    });
  if (e.code === "site_not_allowed") return agentError("site_not_allowed", `${e.message} cannot be opened.`);
  if (e.code === "page_timeout")
    return agentError("page_timeout", `${e.message} did not start loading in ${NAVIGATION_TIMEOUT_MS / 1000} s.`, {
      next_step: "Try once more; if it fails again, tell the person the site is not responding.",
    });
  if (e.code === "ambiguous_target")
    return agentError("ambiguous_target", `${e.count} elements match. Nothing was done. They are:\n${e.message}`, {
      next_step: "Run the command again with the ref of the one you mean.",
    });
  if (e.code === "element_not_found" && e.count === 0)
    return agentError(
      "element_not_found",
      `No element has that role and name. Nothing was done.${e.message ? ` Elements with that role:\n${e.message}` : ""}`,
      { next_step: "Use a ref from `agenta-browser read`." },
    );
  if (e.code === "element_not_found" || /Timeout .*exceeded|not attached|No node found|aria-ref/i.test(e.message || ""))
    return agentError("element_not_found", "That element is not on the page any more, or it cannot be used.", {
      next_step: "Run `agenta-browser read` again and use a ref from the new result.",
    });
  if (e.code === "invalid_arguments") return agentError("invalid_arguments", e.message);
  return agentError("browser_error", errorText(e));
}

module.exports = { OPS, agentError, errorText, fail, navigationAllowed, opError, withScheme };

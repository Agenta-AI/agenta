"use strict";

// A check on obvious pay and delete controls, read from their labels. It is a safety net for a
// model that skips asking, not a boundary: a site can label a pay button anything.

const { ACTION_TIMEOUT_MS } = require("./config.cjs");

const PAY =
  /\b(pay|payment|purchase|buy|checkout|check out|place (?:your |the )?order|complete (?:your |the )?order|confirm (?:order|purchase|payment)|upgrade|donate|send money|transfer)\b/i;
// "Subscribe" alone is mostly a newsletter; it pays when a price or plan sits on the control.
const SUBSCRIBE = /\bsubscri(?:be|ption)\b/i;
const PRICED =
  /[$€£¥₹]|\/\s?(?:mo|month|yr|year)\b|\b(?:per|a) (?:month|year|week)\b|\b(?:monthly|yearly|annually|plan|premium|pro|plus|trial)\b/i;
const DELETE =
  /\b(delete|remove|erase|destroy|discard|deactivate|terminate|revoke|wipe|purge|trash|close (?:my |your |this )?account)\b/i;
// Undoing a view setting removes no data.
const HARMLESS_REMOVE =
  /\bremove (?:all |this |the )?(?:filters?|sort(?:ing)?|selection|highlight(?:ing)?)\b/gi;

function consequenceOf(text) {
  const t = String(text || "");
  if (PAY.test(t) || (SUBSCRIBE.test(t) && PRICED.test(t))) return "pay";
  if (DELETE.test(t.replace(HARMLESS_REMOVE, " "))) return "delete";
  return null;
}

// The control a click on this element activates: itself, or the button or link it sits in.
const ACTIONABLE =
  "xpath=ancestor-or-self::*[self::button or self::a or self::summary or @role='button' or @role='link' or @role='menuitem' or @role='menuitemcheckbox' or @role='menuitemradio' or @role='option' or @role='tab' or @role='switch' or (self::input and (@type='submit' or @type='button' or @type='image'))][1]";
const FORM_SUBMITS =
  'button:not([type]), button[type="submit"], input[type="submit"], input[type="image"]';

// Role, accessible name and named children, as in the page view the model reads.
const labelOf = (locator) => locator.ariaSnapshot({ timeout: ACTION_TIMEOUT_MS });

// A field's own snapshot ends with its value (`- textbox "Name": typed text`); keep the name only.
async function nameOf(locator) {
  const first = (await labelOf(locator)).split("\n")[0];
  return first.replace(/^(- [\w-]+(?: "(?:[^"\\]|\\.)*")?).*$/, "$1");
}

let submitSeq = 0;

// With no form around the field, Enter usually triggers the button beside it: the first
// submit-like control in the nearest container that has one.
async function nearbySubmit(locator) {
  const id = `s${++submitSeq}`;
  const found = await locator.evaluate((field, mark) => {
    const SELECTOR =
      'button, [role="button"], input[type="submit"], input[type="button"], input[type="image"]';
    let node = field.parentElement;
    for (let depth = 0; node && depth < 4; depth++, node = node.parentElement) {
      const controls = [...node.querySelectorAll(SELECTOR)].filter(
        (el) => !el.contains(field),
      );
      if (controls.length) {
        controls[0].setAttribute("data-agenta-submit", mark);
        return true;
      }
    }
    return false;
  }, id);
  return found ? locator.page().locator(`[data-agenta-submit="${id}"]`) : null;
}

// What a person reads on the control the action triggers.
async function controlText(locator, action) {
  if (action === "set") return nameOf(locator);
  if (action === "submit") {
    const form = locator.locator("xpath=ancestor::form[1]");
    if (await form.count()) {
      const buttons = form.locator(FORM_SUBMITS);
      const names = [];
      for (let i = 0; i < (await buttons.count()); i++)
        names.push(await labelOf(buttons.nth(i)));
      return names.join(" ");
    }
    const button = await nearbySubmit(locator);
    return button ? labelOf(button) : "";
  }
  const control = locator.locator(ACTIONABLE);
  return labelOf((await control.count()) ? control.first() : locator);
}

// Reading one element's snapshot replaces the page's aria-ref map; the page snapshot puts the same
// refs back, so the refs the agent already holds keep working after a refusal.
const restoreRefs = (page) => page.ariaSnapshot({ mode: "ai" }).catch(() => {});

// `action` is "click", "submit" (Enter in a field) or "set".
async function requireIntent(locator, intent, action) {
  let kind;
  try {
    kind = consequenceOf(await controlText(locator, action));
  } finally {
    await restoreRefs(locator.page());
  }
  if (kind && kind !== intent) {
    const error = new Error(kind);
    error.code = "needs_approval";
    error.action = action;
    throw error;
  }
}

module.exports = { consequenceOf, requireIntent, restoreRefs };

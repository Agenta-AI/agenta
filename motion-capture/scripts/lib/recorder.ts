import type { Page, Locator } from "playwright";
import type { ClickEvent, FlowContext, Target } from "./flow";

/**
 * Injected into the page (via context.addInitScript) on every navigation. Draws a
 * fake cursor that follows real mouse moves and a ripple on mousedown, so the
 * recorded WebM shows a smooth, legible pointer without any Remotion-side
 * compositing. Because Playwright's `mouse.move(x, y)` dispatches real mousemove
 * events, this cursor glides with it.
 *
 * NOTE: this is a raw JS STRING, not a function. Passing an imported function to
 * addInitScript is unsafe here — tsx/esbuild wraps functions with a `__name(...)`
 * helper (keepNames), and Playwright serializes via `fn.toString()`, so the page
 * would throw `__name is not defined` at document-start and the cursor would
 * silently never appear. A string sidesteps all bundler transforms.
 */
// Hotspot (arrow tip) inside the rendered 44x59 arrow SVG.
const ARROW_HOTX = 2;
const ARROW_HOTY = 2;

export const CURSOR_INIT_SCRIPT = `
(() => {
  // Realistic macOS-style arrow. Black fill + white outline reads clearly on
  // Agenta's light UI; the tip is the hotspot and sits on the click point. On
  // click the arrow presses in (scale) and a small tap ring pulses.
  var ARROW =
    '<svg width="44" height="59" viewBox="0 0 24 32" xmlns="http://www.w3.org/2000/svg">' +
    '<path d="M1 1 L1 23 L6.5 17.8 L10.2 26.6 L13.7 25 L9.95 16.5 L17 16.3 Z" ' +
    'fill="#111418" stroke="#ffffff" stroke-width="1.6" stroke-linejoin="round" ' +
    'paint-order="stroke"/></svg>';
  var HOTX = ${ARROW_HOTX}, HOTY = ${ARROW_HOTY};
  const mount = () => {
    if (document.getElementById('pw-cursor')) return;
    if (!document.body) return;
    const style = document.createElement('style');
    style.textContent =
      '* { cursor: none !important; } ' +
      '#pw-cursor{position:fixed;top:0;left:0;pointer-events:none;z-index:2147483647;' +
      'transform:translate(-300px,-300px);transform-origin:' + HOTX + 'px ' + HOTY + 'px;' +
      'transition:transform .06s ease-out;filter:drop-shadow(0 3px 6px rgba(0,0,0,.5));} ' +
      '#pw-cursor svg{display:block;} ' +
      '.pw-ripple{position:fixed;width:28px;height:28px;margin:-14px 0 0 -14px;border-radius:50%;' +
      'border:3px solid rgba(37,99,235,.9);background:rgba(37,99,235,.16);' +
      'pointer-events:none;z-index:2147483646;animation:pw-ripple .5s ease-out forwards;} ' +
      '@keyframes pw-ripple{from{transform:scale(.25);opacity:.9;}to{transform:scale(1.4);opacity:0;}}';
    document.documentElement.appendChild(style);
    const c = document.createElement('div');
    c.id = 'pw-cursor';
    c.innerHTML = ARROW;
    document.body.appendChild(c);
    let x = -300, y = -300;
    const place = (s) => { c.style.transform = 'translate(' + (x - HOTX) + 'px,' + (y - HOTY) + 'px) scale(' + s + ')'; };
    document.addEventListener('mousemove', (e) => { x = e.clientX; y = e.clientY; place(1); }, true);
    document.addEventListener('mousedown', () => {
      place(0.9);
      const r = document.createElement('div');
      r.className = 'pw-ripple';
      r.style.left = x + 'px';
      r.style.top = y + 'px';
      document.body.appendChild(r);
      setTimeout(() => r.remove(), 520);
    }, true);
    document.addEventListener('mouseup', () => place(1), true);
  };
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', mount);
  } else {
    mount();
  }
})();
`;

/** An element's on-screen rectangle (viewport CSS px). */
type Rect = { x: number; y: number; w: number; h: number };

function isPoint(t: Target): t is { x: number; y: number } {
  return typeof t === "object" && t !== null && "x" in t && typeof (t as { x: unknown }).x === "number";
}

/**
 * Resolve a target to its center point AND its bounding rect. The rect lets the
 * Remotion zoom frame the whole element (not stab a single pixel). Point targets
 * get a small synthetic rect so they still have a region to frame.
 */
async function boxOf(page: Page, target: Target): Promise<{ cx: number; cy: number; rect: Rect }> {
  if (isPoint(target)) {
    return { cx: target.x, cy: target.y, rect: { x: target.x - 60, y: target.y - 24, w: 120, h: 48 } };
  }
  const loc: Locator = (typeof target === "string" ? page.locator(target) : target).first();
  await loc.waitFor({ state: "visible", timeout: 20000 });
  await loc.scrollIntoViewIfNeeded();
  const box = await loc.boundingBox();
  if (!box) throw new Error(`No bounding box for target: ${typeof target === "string" ? target : "<locator>"}`);
  return {
    cx: box.x + box.width / 2,
    cy: box.y + box.height / 2,
    rect: { x: box.x, y: box.y, w: box.width, h: box.height },
  };
}

const roundRect = (r: Rect): Rect => ({ x: Math.round(r.x), y: Math.round(r.y), w: Math.round(r.w), h: Math.round(r.h) });

// Cubic ease-in-out for cursor travel — accelerate then decelerate.
const easeInOut = (p: number) => (p < 0.5 ? 4 * p * p * p : 1 - Math.pow(-2 * p + 2, 3) / 2);

/**
 * Builds the helper set a flow uses. `clicks` and `getElapsedMs` are shared so
 * every logged click is timestamped against the recording start.
 */
export function buildContext(
  page: Page,
  baseURL: string,
  clicks: ClickEvent[],
  getElapsedMs: () => number,
): FlowContext {
  const pause = (ms = 700) => page.waitForTimeout(ms);

  // Track the cursor so each glide starts where the last ended (continuous motion,
  // no jumps between actions). Default to viewport center.
  let last = { x: 960, y: 540 };

  const glideTo = async (x: number, y: number) => {
    const dist = Math.hypot(x - last.x, y - last.y);
    // Fewer, quicker steps — snappy but still eased. (Was 20–58 steps @10ms with
    // slowMo:30 on top, which made the cursor crawl.)
    const steps = Math.max(14, Math.min(34, Math.round(dist / 22)));
    const from = { ...last };
    for (let i = 1; i <= steps; i++) {
      const p = easeInOut(i / steps);
      await page.mouse.move(from.x + (x - from.x) * p, from.y + (y - from.y) * p);
      await page.waitForTimeout(5);
    }
    last = { x, y };
    await pause(50);
  };

  const clickAt = async (x: number, y: number, rect: Rect, label?: string) => {
    await page.mouse.down();
    await pause(90);
    await page.mouse.up();
    clicks.push({ label, tMs: getElapsedMs(), x: Math.round(x), y: Math.round(y), rect: roundRect(rect) });
  };

  const moveAndClick: FlowContext["moveAndClick"] = async (target, label) => {
    const { cx, cy, rect } = await boxOf(page, target);
    await glideTo(cx, cy);
    await clickAt(cx, cy, rect, label ?? (typeof target === "string" ? target : undefined));
  };

  const typeInto: FlowContext["typeInto"] = async (selector, text, label) => {
    const { cx, cy, rect } = await boxOf(page, selector);
    await glideTo(cx, cy);
    await clickAt(cx, cy, rect, label ?? (typeof selector === "string" ? selector : "field"));
    await pause(150);
    await page.keyboard.type(text, { delay: 42 });
  };

  return {
    page,
    baseURL,
    moveAndClick,
    typeInto,
    pause,
    page_waitForURL: page.waitForURL.bind(page),
  };
}

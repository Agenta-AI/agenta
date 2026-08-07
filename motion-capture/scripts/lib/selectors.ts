import type { Locator, Page } from "playwright";

/**
 * A single way to find an element. `by` is a short human label (e.g. "role=combobox")
 * used in the ✓/✗ logs and failure diagnostics, so when something breaks you see
 * exactly which strategy matched — or which ones were tried.
 */
export type Candidate = { by: string; locator: Locator };

/** Thrown when no candidate for a labelled target becomes visible in time. */
export class SelectorError extends Error {
  constructor(
    public readonly label: string,
    public readonly tried: string[],
    public readonly dump: string,
  ) {
    super(`Could not resolve "${label}".\n  tried: ${tried.join(" | ")}\n${dump}`);
    this.name = "SelectorError";
  }
}

const OK = "✓"; // ✓
const NO = "✗"; // ✗

/**
 * Snapshot the visible, interactive elements on the page — used in failure
 * diagnostics so a broken selector immediately shows what IS on screen instead of a
 * bare "not found". (Generalized from the old ad-hoc probe dump.)
 */
export async function dumpVisible(page: Page, max = 24): Promise<string> {
  try {
    const items = (await page.evaluate(`(function(){
      function vis(e){var r=e.getBoundingClientRect();var s=getComputedStyle(e);
        return r.width>2&&r.height>2&&s.visibility!=='hidden'&&s.display!=='none'&&s.opacity!=='0'&&r.bottom>0&&r.top<innerHeight&&r.right>0&&r.left<innerWidth;}
      var sel='button,[role=button],[role=combobox],[role=option],a,input,textarea,select,.ant-select';
      var els=[].slice.call(document.querySelectorAll(sel));
      var out=[];
      for(var i=0;i<els.length;i++){var e=els[i];if(!vis(e))continue;var r=e.getBoundingClientRect();
        var t=(e.getAttribute('aria-label')||e.getAttribute('placeholder')||e.textContent||'').trim().replace(/\\s+/g,' ').slice(0,44);
        out.push({tag:e.tagName.toLowerCase(),role:e.getAttribute('role')||'',type:e.getAttribute('type')||'',t:t,x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width),h:Math.round(r.height)});
      }
      return out.slice(0, ${max});
    })()`)) as Array<{ tag: string; role: string; type: string; t: string; x: number; y: number; w: number; h: number }>;
    const lines = items.map(
      (e) =>
        `    · <${e.tag}${e.role ? ` role=${e.role}` : ""}${e.type ? ` type=${e.type}` : ""}> "${e.t}" @${e.x},${e.y} ${e.w}×${e.h}`,
    );
    return `  on screen now:\n${lines.join("\n") || "    (no visible interactive elements)"}`;
  } catch {
    return "  (could not snapshot page)";
  }
}

/**
 * Return the first candidate that is currently visible, without waiting or logging.
 * For soft checks (e.g. "is the panel already open?") where absence is not an error.
 */
export async function softFirst(candidates: Candidate[]): Promise<Locator | null> {
  for (const c of candidates) {
    try {
      const loc = c.locator.first();
      if (await loc.isVisible()) return loc;
    } catch {
      /* not attached */
    }
  }
  return null;
}

/**
 * Try each candidate in order until one is visible (polling up to `timeoutMs`).
 * Logs `✓ <label> via <by>` with the winning strategy so drift is visible on every
 * run. On timeout logs `✗` and throws a SelectorError carrying a snapshot of what is
 * actually on screen — turning a blind failure into an obvious one.
 */
export async function resolveFirst(
  page: Page,
  label: string,
  candidates: Candidate[],
  opts: { timeoutMs?: number } = {},
): Promise<Locator> {
  const timeoutMs = opts.timeoutMs ?? 15000;
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    for (const c of candidates) {
      try {
        const loc = c.locator.first();
        if (await loc.isVisible()) {
          console.log(`  ${OK} ${label} via ${c.by}`);
          return loc;
        }
      } catch {
        /* not attached yet */
      }
    }
    await page.waitForTimeout(250);
  }
  const tried = candidates.map((c) => c.by);
  console.error(`  ${NO} ${label} — none of [${tried.join(", ")}] visible in ${timeoutMs}ms`);
  throw new SelectorError(label, tried, await dumpVisible(page));
}

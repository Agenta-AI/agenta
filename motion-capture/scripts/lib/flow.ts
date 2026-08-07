import type { Page, Locator } from "playwright";

/** A click/type target: a CSS selector, an absolute point, or a Playwright Locator. */
export type Target = string | { x: number; y: number } | Locator;

/**
 * A single logged click. Coordinates are in viewport CSS pixels, which — because
 * `recordVideo.size === viewport` and `deviceScaleFactor: 1` — map 1:1 to pixels
 * in the recorded video and therefore to the Remotion composition. `tMs` is the
 * time of the click relative to the start of recording, so the composition can
 * place a zoom keyframe there without any hand-tuning.
 */
export type ClickEvent = {
  label?: string;
  tMs: number;
  x: number;
  y: number;
  /** The clicked element's bounding rect (viewport CSS px) so the zoom can frame
   *  the whole control instead of a single pixel. */
  rect?: { x: number; y: number; w: number; h: number };
};

/** The sidecar written next to the .mp4 and read by the Remotion composition. */
export type ClickLog = {
  name: string;
  viewport: { width: number; height: number };
  /** Duration of the kept (demo) portion in ms; used to size the composition. */
  durationMs: number;
  /** Trim this many ms off the FRONT of the video (e.g. login) before the demo. */
  trimBeforeMs?: number;
  /** Manual nudge (ms) applied to every click time if video/log drift shows up. */
  offsetMs?: number;
  clicks: ClickEvent[];
};

/**
 * Helpers handed to a flow. They perform the action AND (for clicks) log it, so
 * a flow reads like a script of user actions and the zoom timing falls out for free.
 */
export type FlowContext = {
  page: Page;
  baseURL: string;
  /** Glide the cursor to a target (selector, point, or Locator) and click it. Logged. */
  moveAndClick: (target: Target, label?: string) => Promise<void>;
  /** Click a field (logged) then type into it at a human speed. */
  typeInto: (selector: string | Locator, text: string, label?: string) => Promise<void>;
  /** Pause for viewer comprehension. Defaults to 700ms. */
  pause: (ms?: number) => Promise<void>;
  /** Wait for a URL/selector without moving the cursor (no zoom). */
  page_waitForURL: Page["waitForURL"];
};

export type Flow = {
  /** Used for output filenames: recordings/<name>.webm, public/<name>.mp4, etc. */
  name: string;
  viewport: { width: number; height: number };
  /** The actions to record. Use ctx helpers so clicks are logged for zoom. */
  run: (ctx: FlowContext) => Promise<void>;
};

export function defineFlow(flow: Flow): Flow {
  return flow;
}

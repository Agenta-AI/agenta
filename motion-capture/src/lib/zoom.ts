import { interpolate, Easing } from "remotion";

export type ClickEvent = {
  label?: string;
  tMs: number;
  x: number;
  y: number;
  /** The clicked element's bounding rect (viewport CSS px). When present the zoom
   *  frames the whole control; otherwise it falls back to a small box around x/y. */
  rect?: { x: number; y: number; w: number; h: number };
};

export type ClickLog = {
  name: string;
  viewport: { width: number; height: number };
  durationMs: number;
  trimBeforeMs?: number;
  offsetMs?: number;
  clicks: ClickEvent[];
};

export const EMPTY_LOG: ClickLog = {
  name: "",
  viewport: { width: 1920, height: 1080 },
  durationMs: 8000,
  offsetMs: 0,
  clicks: [],
};

export type ZoomState = {
  scale: number;
  /** transform-origin as fractions of the video element (0..1). */
  originX: number;
  originY: number;
};

// Envelope timing of one zoom CLUSTER, in seconds.
const LEAD = 0.5; // ease in before the first click of a cluster
const HOLD = 0.85; // stay zoomed after the last click while the result registers
const TRAIL = 0.55; // ease back out

// Region-framing knobs.
const S_MIN = 1.22; // gentlest zoom (large controls)
const S_MAX = 1.5; // punchiest zoom (tiny controls) — kept moderate to avoid heavy crop
const PAD = 90; // px of breathing room around the control when framing
const MENU_ROOM = 130; // px extra space kept BELOW the control (dropdowns open there)
const FRAME_FRAC = 0.6; // padded control should fill ~60% of the frame at target scale

// Clustering: start a NEW zoom cycle (out, then in) only on a real scene change —
// a far cursor jump OR a long pause. Consecutive nearby clicks share one cycle: the
// camera zooms in once, pans to follow each click, and zooms out after the last.
const GROUP_TIME_GAP = 8; // s: a pause longer than this splits into a new cluster
const GROUP_DIST_FRAC = 0.33; // fraction of the diagonal: a jump farther than this splits

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v));
const EASE = { easing: Easing.inOut(Easing.ease), extrapolateLeft: "clamp", extrapolateRight: "clamp" } as const;

type Frame = { scale: number; originX: number; originY: number };

/**
 * Frame a single click's element region: adaptive scale that fits the padded
 * control, then a CLAMPED camera so the frame stays fully covered (no backdrop
 * leak) and the control is pulled inward as far as physically possible. Extra room
 * is kept below the control so a dropdown opening there stays visible.
 */
function frameFor(c: ClickEvent, vp: { width: number; height: number }): Frame {
  const W = vp.width;
  const H = vp.height;
  const rect = c.rect ?? { x: c.x - 60, y: c.y - 24, w: 120, h: 48 };

  const extW = rect.w;
  const extH = rect.h + MENU_ROOM;
  const extCx = rect.x + rect.w / 2;
  const extCy = rect.y + rect.h / 2 + MENU_ROOM / 2;

  const sByW = (FRAME_FRAC * W) / (extW + 2 * PAD);
  const sByH = (FRAME_FRAC * H) / (extH + 2 * PAD);
  const S = clamp(Math.min(sByW, sByH), S_MIN, S_MAX);

  const half = 1 / (2 * S);
  const Cx = clamp(extCx / W, half, 1 - half);
  const Cy = clamp(extCy / H, half, 1 - half);

  const Ox = (0.5 - Cx * S) / (1 - S);
  const Oy = (0.5 - Cy * S) / (1 - S);
  return { scale: S, originX: clamp(Ox, 0, 1), originY: clamp(Oy, 0, 1) };
}

/**
 * Group clicks into clusters. A new cluster starts when the next click is far away
 * on screen (a scene change) OR after a long pause; otherwise clicks accumulate into
 * the current cluster so they share a single zoom-in/pan/zoom-out cycle.
 */
function clusterize(clicks: ClickEvent[], vp: { width: number; height: number }): ClickEvent[][] {
  if (clicks.length === 0) return [];
  const diag = Math.hypot(vp.width, vp.height);
  const groups: ClickEvent[][] = [[clicks[0]]];
  for (let i = 1; i < clicks.length; i++) {
    const prev = clicks[i - 1];
    const cur = clicks[i];
    const dt = (cur.tMs - prev.tMs) / 1000;
    const dist = Math.hypot(cur.x - prev.x, cur.y - prev.y) / diag;
    if (dt > GROUP_TIME_GAP || dist > GROUP_DIST_FRAC) groups.push([cur]);
    else groups[groups.length - 1].push(cur);
  }
  return groups;
}

/**
 * The zoom state contributed by one cluster at time `t` (seconds, offset-adjusted),
 * or null if the cluster isn't active. The scale ramps 1->S once (before the first
 * click), holds through the cluster while the origin+scale interpolate between each
 * click's framing (the camera "follows" the cursor), then ramps S->1 once after the
 * last click.
 */
function clusterState(t: number, group: ClickEvent[], vp: { width: number; height: number }): ZoomState | null {
  const frames = group.map((c) => ({ ct: c.tMs / 1000, f: frameFor(c, vp) }));
  const ctFirst = frames[0].ct;
  const ctLast = frames[frames.length - 1].ct;
  const start = ctFirst - LEAD;
  const holdEnd = ctLast + HOLD;
  const end = ctLast + HOLD + TRAIL;
  if (t < start || t > end) return null;

  // Envelope: 0 -> 1 (ease in), 1 (hold), 1 -> 0 (ease out).
  let m: number;
  if (t < ctFirst) m = interpolate(t, [start, ctFirst], [0, 1], EASE);
  else if (t <= holdEnd) m = 1;
  else m = interpolate(t, [holdEnd, end], [1, 0], EASE);

  // Target framing: hold the first click's frame until it happens, the last click's
  // after it, and interpolate between the surrounding two in between (pan + morph).
  let tf: Frame;
  if (t <= frames[0].ct) {
    tf = frames[0].f;
  } else if (t >= frames[frames.length - 1].ct) {
    tf = frames[frames.length - 1].f;
  } else {
    let i = 0;
    while (i < frames.length - 1 && t > frames[i + 1].ct) i++;
    const a = frames[i];
    const b = frames[i + 1];
    tf = {
      scale: interpolate(t, [a.ct, b.ct], [a.f.scale, b.f.scale], EASE),
      originX: interpolate(t, [a.ct, b.ct], [a.f.originX, b.f.originX], EASE),
      originY: interpolate(t, [a.ct, b.ct], [a.f.originY, b.f.originY], EASE),
    };
  }

  return { scale: 1 + (tf.scale - 1) * m, originX: tf.originX, originY: tf.originY };
}

/**
 * Returns the scale + origin to apply to the clip at the given frame. Clicks are
 * grouped into clusters; each cluster is one smooth zoom-in / follow / zoom-out.
 * If clusters ever overlap in time, the stronger (more zoomed) one wins.
 */
export function zoomAt(frame: number, fps: number, log: ClickLog): ZoomState {
  const offset = (log.offsetMs ?? 0) / 1000;
  const t = frame / fps - offset;

  let best: ZoomState = { scale: 1, originX: 0.5, originY: 0.5 };
  for (const group of clusterize(log.clicks, log.viewport)) {
    const s = clusterState(t, group, log.viewport);
    if (s && s.scale > best.scale) best = s;
  }
  return best;
}

/**
 * F4 - Load & scale simulator. Hand-rolled canvas + requestAnimationFrame
 * (no simulation library, per PLAN.md), sliders directly above the canvas in
 * the samwho.dev pattern: every frame redraws from whatever the sliders
 * currently say, no separate "run" button.
 *
 * The pipeline math lives in ./pipeline.ts (pure, framework-free) so the
 * animation loop here only has to read the model each frame and paint it.
 */
import { useEffect, useMemo, useRef, useState } from "react";
import { loadModel } from "../../model";
import {
  COLD_START_RANGE,
  computeLatencyStats,
  contentionMultiplier,
  createSimState,
  RELAY_POLL_CONSTANTS,
  RUNNER_QUEUE_STAGE_MS,
  SERVICE_STAGE_MS,
  STAGE_LABELS,
  STAGE_ORDER,
  stageDurationMs,
  stepSim,
  TEARDOWN_STAGE_MS,
  TURN_DURATION_RANGE,
  type ColdStartPreset,
  type ConcurrencyMode,
  type SimConfig,
  type SimState,
  type StageId,
} from "./pipeline";
import { FigureFrame } from "../shared/FigureFrame";
import "./load.css";

/** Model-ms advanced per real-ms; keeps a 15s Daytona cold start + 30s turn watchable in a few real seconds. */
const TIME_SCALE = 10;
const STATS_REFRESH_EVERY_N_FRAMES = 6;
const CANVAS_HEIGHT = 300;
const CANVAS_MARGIN = 16;
const STAGE_LABEL_HEIGHT = 34;

interface Colors {
  bg: string;
  border: string;
  borderStrong: string;
  textMuted: string;
  accent: string;
  service: string;
  runner: string;
  sandbox: string;
  platform: string;
  warn: string;
}

function readColors(): Colors {
  const style = getComputedStyle(document.documentElement);
  const v = (name: string, fallback: string) => style.getPropertyValue(name).trim() || fallback;
  return {
    bg: v("--color-bg", "#fff"),
    border: v("--color-border", "#ddd"),
    borderStrong: v("--color-border-strong", "#999"),
    textMuted: v("--color-text-muted", "#666"),
    accent: v("--color-accent", "#a8493a"),
    service: v("--tier-service", "#3f8f6d"),
    runner: v("--tier-runner", "#a8493a"),
    sandbox: v("--tier-sandbox", "#8a5cb0"),
    platform: v("--tier-platform", "#b8862f"),
    warn: v("--status-experimental", "#b8862f"),
  };
}

const STAGE_COLOR_KEY: Record<StageId, keyof Colors> = {
  service: "service",
  runnerQueue: "runner",
  sandboxCreate: "sandbox",
  turn: "platform",
  teardown: "textMuted",
};

function formatMs(ms: number | undefined): string {
  if (ms === undefined) return "·";
  if (ms < 1000) return `${Math.round(ms)} ms`;
  return `${(ms / 1000).toFixed(1)} s`;
}

export function LoadSim() {
  // Default sits comfortably under this pipeline's illustrative capacity at the
  // default concurrency (~50 req/min at concurrency 4, cold=local, turn=3s), so
  // the figure opens calm; raising the slider is what demonstrates saturation.
  const [arrivalPerMin, setArrivalPerMin] = useState(30);
  const [runnerConcurrency, setRunnerConcurrency] = useState(4);
  // Defaults to "unlimited": that is what the runner actually does today
  // (structural fact no-runner-concurrency-limit). The bounded slider is an
  // explicit what-if, not the default story.
  const [concurrencyMode, setConcurrencyMode] = useState<ConcurrencyMode>("unlimited");
  const [coldStartPreset, setColdStartPreset] = useState<ColdStartPreset>("local");
  const [coldStartMs, setColdStartMs] = useState(() => midpoint(COLD_START_RANGE.local));
  const [turnDurationMs, setTurnDurationMs] = useState(3000);

  const prefersReducedMotionRef = useRef(
    typeof window !== "undefined" ? window.matchMedia("(prefers-reduced-motion: reduce)").matches : false,
  );
  const [playing, setPlaying] = useState(() => !prefersReducedMotionRef.current);
  const [visible, setVisible] = useState(true);
  const [stats, setStats] = useState({ inFlight: 0, queued: 0, p50: undefined as number | undefined, p95: undefined as number | undefined });

  const wrapRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const simStateRef = useRef<SimState>(createSimState());
  const colorsRef = useRef<Colors>(
    typeof window !== "undefined" ? readColors() : ({} as Colors),
  );

  const config: SimConfig = useMemo(
    () => ({ arrivalPerMin, runnerConcurrency, concurrencyMode, coldStartPreset, coldStartMs, turnDurationMs }),
    [arrivalPerMin, runnerConcurrency, concurrencyMode, coldStartPreset, coldStartMs, turnDurationMs],
  );
  const configRef = useRef(config);
  configRef.current = config;

  // Re-read CSS custom properties once, and again whenever the OS light/dark
  // preference flips, per the light+dark canvas requirement.
  useEffect(() => {
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const refresh = () => {
      colorsRef.current = readColors();
    };
    refresh();
    mq.addEventListener("change", refresh);
    return () => mq.removeEventListener("change", refresh);
  }, []);

  // Pause when the figure scrolls offscreen; resume tracks the play button, not visibility alone.
  useEffect(() => {
    const el = wrapRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(([entry]) => setVisible(entry.isIntersecting), { threshold: 0.1 });
    observer.observe(el);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!playing || !visible) return;
    let raf = 0;
    let last = performance.now();
    let frameCount = 0;

    function frame(now: number) {
      const realDt = Math.min(now - last, 100); // clamp huge gaps (tab backgrounded, devtools pause, etc.)
      last = now;
      const simDt = realDt * TIME_SCALE;
      simStateRef.current = stepSim(simStateRef.current, simDt, configRef.current);
      draw();

      frameCount += 1;
      if (frameCount % STATS_REFRESH_EVERY_N_FRAMES === 0) {
        const { p50, p95 } = computeLatencyStats(simStateRef.current.completedLatencies);
        setStats({
          inFlight: simStateRef.current.dots.length,
          queued: simStateRef.current.dots.filter((d) => d.queued).length,
          p50,
          p95,
        });
      }
      raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [playing, visible]);

  // Draw one static frame whenever paused/offscreen so a slider tweak while
  // paused still visibly updates the stage layout (samwho.dev: always redraw
  // from current slider values).
  useEffect(() => {
    if (!playing || !visible) draw();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config, playing, visible]);

  function draw() {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const colors = colorsRef.current;
    const width = canvas.clientWidth;
    const height = canvas.clientHeight;
    if (canvas.width !== width * devicePixelRatio || canvas.height !== height * devicePixelRatio) {
      canvas.width = width * devicePixelRatio;
      canvas.height = height * devicePixelRatio;
    }
    ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const inFlightCount = simStateRef.current.dots.length;
    const layout = computeStageLayout(width, configRef.current, inFlightCount);
    const laneTop = STAGE_LABEL_HEIGHT;
    const laneHeight = height - STAGE_LABEL_HEIGHT - CANVAS_MARGIN;

    // Stage bands + labels.
    STAGE_ORDER.forEach((stageId, i) => {
      const seg = layout.segments[i];
      ctx.strokeStyle = colors.border;
      ctx.lineWidth = 1;
      ctx.strokeRect(seg.x, laneTop, seg.width, laneHeight);
      ctx.fillStyle = colors.textMuted;
      ctx.font = "11px var(--font-sans, sans-serif)";
      ctx.textAlign = "left";
      ctx.fillText(STAGE_LABELS[stageId], seg.x + 4, laneTop - 6);
    });

    // Queued dots stack vertically at the runnerQueue segment's left edge.
    const runnerSeg = layout.segments[STAGE_ORDER.indexOf("runnerQueue")];
    let queueStackIndex = 0;

    for (const dot of simStateRef.current.dots) {
      const seg = layout.segments[STAGE_ORDER.indexOf(dot.stage)];
      const duration = stageDurationMs(dot.stage, configRef.current, inFlightCount);
      let x: number;
      let y: number;

      if (dot.queued) {
        x = runnerSeg.x + 5;
        const col = Math.floor(queueStackIndex / 12);
        const row = queueStackIndex % 12;
        y = laneTop + 8 + row * 9;
        x += col * 10;
        queueStackIndex += 1;
      } else {
        const frac = duration > 0 ? Math.min(1, dot.progressMs / duration) : 1;
        x = seg.x + frac * seg.width;
        y = laneTop + laneHeight / 2 + ((dot.lane - 5) * (laneHeight / 2 / 6));
      }

      ctx.beginPath();
      ctx.fillStyle = dot.queued ? colors.warn : colors[STAGE_COLOR_KEY[dot.stage]];
      ctx.arc(x, y, dot.queued ? 3 : 3.5, 0, Math.PI * 2);
      ctx.fill();
    }

    if (queueStackIndex > 0) {
      ctx.fillStyle = colors.warn;
      ctx.font = "10px var(--font-sans, sans-serif)";
      ctx.fillText(`${queueStackIndex} queued`, runnerSeg.x + 4, laneTop + laneHeight + 12);
    }
  }

  function midpointOfCurrentPreset(preset: ColdStartPreset) {
    return midpoint(COLD_START_RANGE[preset]);
  }

  function handlePresetChange(preset: ColdStartPreset) {
    setColdStartPreset(preset);
    setColdStartMs(midpointOfCurrentPreset(preset));
  }

  /** Clears dots/queue/stats/percentiles; slider and mode values are untouched. */
  function handleReset() {
    simStateRef.current = createSimState();
    setStats({ inFlight: 0, queued: 0, p50: undefined, p95: undefined });
    draw();
  }

  const coldRange = COLD_START_RANGE[coldStartPreset];
  const relayMin = RELAY_POLL_CONSTANTS.RELAY_POLL_MS;
  const relayMax = RELAY_POLL_CONSTANTS.RELAY_POLL_MAX_MS;
  const isUnlimited = concurrencyMode === "unlimited";
  const contentionActive = isUnlimited && coldStartPreset === "local";

  return (
    <FigureFrame>
      <div className="figure-shell load-sim" ref={wrapRef}>
        <div className="figure-toolbar">
          <span>F4 &middot; Load &amp; scale simulator</span>
          <div className="step-controls">
            <button type="button" className="load-play-toggle" onClick={handleReset}>
              Reset
            </button>
            <button type="button" className="load-play-toggle" onClick={() => setPlaying((p) => !p)}>
              {playing ? "Pause" : "Play"}
            </button>
          </div>
        </div>

      <p className="load-disclaimer" role="note">
        {loadModel.disclaimer}
      </p>

      <div className="load-mode-row">
        <span className="field-label" style={{ margin: 0 }}>
          Runner behavior
        </span>
        <div className="load-preset-row">
          <button
            type="button"
            data-active={concurrencyMode === "unlimited"}
            onClick={() => setConcurrencyMode("unlimited")}
          >
            Today&rsquo;s runner: no limit
          </button>
          <button
            type="button"
            data-active={concurrencyMode === "bounded"}
            onClick={() => setConcurrencyMode("bounded")}
          >
            What-if: bounded concurrency
          </button>
        </div>
        <span className="load-mode-note">
          {isUnlimited
            ? "The real runner has no queue today: every /run starts immediately (services/runner/src/server.ts, engines/sandbox_agent.ts). Overload degrades instead of queueing."
            : "Hypothetical: a fixed-size concurrency pool. Not how the runner behaves today; the queue below only exists in this what-if."}
        </span>
      </div>

      <div className="load-sliders">
        <label className="load-slider">
          <span>Arrival rate: {arrivalPerMin} req/min</span>
          <input
            type="range"
            name="arrivalRate"
            min={6}
            max={600}
            step={6}
            value={arrivalPerMin}
            onChange={(e) => setArrivalPerMin(Number(e.target.value))}
          />
        </label>

        {isUnlimited ? (
          <div className="load-slider">
            <span>Runner concurrency</span>
            <span className="load-slider-value">
              Not applicable in no-limit mode: nothing queues, so there is no pool size to set.
            </span>
          </div>
        ) : (
          <label className="load-slider">
            <span>Runner concurrency: {runnerConcurrency}</span>
            <input
              type="range"
              name="runnerConcurrency"
              min={1}
              max={16}
              step={1}
              value={runnerConcurrency}
              onChange={(e) => setRunnerConcurrency(Number(e.target.value))}
            />
          </label>
        )}

        <div className="load-slider">
          <span>Sandbox cold start</span>
          <div className="load-preset-row">
            <button type="button" data-active={coldStartPreset === "local"} onClick={() => handlePresetChange("local")}>
              local
            </button>
            <button
              type="button"
              data-active={coldStartPreset === "daytona"}
              onClick={() => handlePresetChange("daytona")}
            >
              daytona
            </button>
          </div>
          <input
            type="range"
            name="coldStartMs"
            min={coldRange.min}
            max={coldRange.max ?? coldRange.min}
            step={Math.max(1, Math.round(((coldRange.max ?? coldRange.min) - coldRange.min) / 100))}
            value={coldStartMs}
            onChange={(e) => setColdStartMs(Number(e.target.value))}
          />
          <span className="load-slider-value">
            {formatMs(coldStartMs)} (range {formatMs(coldRange.min)}–{formatMs(coldRange.max ?? coldRange.min)},
            illustrative)
          </span>
        </div>

        <label className="load-slider">
          <span>Turn duration: {formatMs(turnDurationMs)}</span>
          <input
            type="range"
            name="turnDuration"
            min={TURN_DURATION_RANGE.min}
            max={TURN_DURATION_RANGE.max}
            step={100}
            value={turnDurationMs}
            onChange={(e) => setTurnDurationMs(Number(e.target.value))}
          />
        </label>
      </div>

      <div className="load-canvas-wrap" style={{ height: CANVAS_HEIGHT }}>
        <canvas ref={canvasRef} className="load-canvas" style={{ width: "100%", height: CANVAS_HEIGHT }} />
      </div>

      <div className="load-counters">
        <div className="load-counter">
          <span className="load-counter-value">{stats.inFlight}</span>
          <span className="load-counter-label">in-flight</span>
        </div>
        <div className="load-counter">
          <span className="load-counter-value" data-warn={stats.queued > 0}>
            {isUnlimited ? "—" : stats.queued}
          </span>
          <span className="load-counter-label">queued{isUnlimited ? " (what-if only)" : ""}</span>
        </div>
        <div className="load-counter">
          <span className="load-counter-value">{formatMs(stats.p50)}</span>
          <span className="load-counter-label">p50 end-to-end</span>
        </div>
        <div className="load-counter">
          <span className="load-counter-value">{formatMs(stats.p95)}</span>
          <span className="load-counter-label">p95 end-to-end</span>
        </div>
      </div>

      {contentionActive && (
        <p className="load-contention-note" role="note">
          Contention, illustrative: with no queue to absorb overload, concurrent local-sandbox runs share one
          container's CPU/RAM, so sandbox-create and turn-execution durations above are inflated as the in-flight
          count grows ({stats.inFlight} in flight now, &times;{contentionMultiplier(stats.inFlight).toFixed(2)}).
          Daytona sandboxes each get their own VM, so this mode shows no such slowdown there.
        </p>
      )}

      <p className="load-relay-note">
        Real, code-verified numbers (not illustrative): the tool-relay poll loop backs off from{" "}
        <code>{relayMin ?? "?"}ms</code> to <code>{relayMax ?? "?"}ms</code> while idle (
        <code>services/runner/src/tools/relay.ts</code>). Folded into the "harness turn" band above rather than
        drawn separately.
      </p>

      <div className="field-label">Structural facts this simulator is built to show</div>
      <ul className="load-facts">
        {loadModel.structuralFacts.map((fact) => (
          <li key={fact.id}>
            <strong>{fact.id}.</strong> {fact.fact}
          </li>
        ))}
      </ul>

      <div className="load-fixed-costs">
        Fixed illustrative costs folded into "service" / "runner" / "teardown": service &asymp;{" "}
        {formatMs(SERVICE_STAGE_MS)}, runner dispatch &asymp; {formatMs(RUNNER_QUEUE_STAGE_MS)}, teardown &asymp;{" "}
        {formatMs(TEARDOWN_STAGE_MS)}.
      </div>
      </div>
    </FigureFrame>
  );
}

function midpoint(range: { min: number; max: number | null }): number {
  const max = range.max ?? range.min;
  return Math.round((range.min + max) / 2);
}

interface StageSegment {
  x: number;
  width: number;
}

function computeStageLayout(
  width: number,
  config: SimConfig,
  inFlightCount = 0,
): { segments: StageSegment[] } {
  const usable = Math.max(width - CANVAS_MARGIN * 2, 100);
  const weights = STAGE_ORDER.map((id) =>
    Math.log10(Math.max(stageDurationMs(id, config, inFlightCount), 1) + 1),
  );
  const totalWeight = weights.reduce((a, b) => a + b, 0) || 1;
  const segments: StageSegment[] = [];
  let x = CANVAS_MARGIN;
  for (const w of weights) {
    const segWidth = (w / totalWeight) * usable;
    segments.push({ x, width: segWidth });
    x += segWidth;
  }
  return { segments };
}

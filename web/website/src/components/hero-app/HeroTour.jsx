// The "tour" hero: four scripted states of the app mockup that advance on their own.
// Each dash fills over its step's time, then the mockup cross-fades to the next step and the
// tour loops. Arrows and dashes jump to a step and restart its timer. The timer pauses while the
// pointer is over the mockup, while someone uses it, while the tour is off screen and while the
// tab is hidden. With reduced motion there is no auto-advance, no typing and no fade.
import { useCallback, useEffect, useRef, useState } from "react";
import { CaretLeft, CaretRight } from "./ph.jsx";
import HeroApp from "./HeroApp.jsx";

const STEPS = [
  { preset: "build", title: "Build", ms: 6860 },
  { preset: "work", title: "Work", ms: 4000 },
  { preset: "deploy", title: "Deploy", ms: 4000 },
  { preset: "govern", title: "Govern", ms: 4000 },
];
// After a touch or a key press inside the mockup, the timer waits this long.
const INTERACT_PAUSE_MS = 10000;

const useReducedMotion = () => {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(prefers-reduced-motion: reduce)");
    const on = () => setReduced(mq.matches);
    on();
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return reduced;
};

export default function HeroTour() {
  const [step, setStep] = useState(0);
  const [prev, setPrev] = useState(null);
  const reduced = useReducedMotion();
  const rootRef = useRef(null);
  const frameRef = useRef(null);
  const fills = useRef([]);
  const elapsed = useRef(0);
  const pause = useRef({
    hover: false,
    focus: false,
    offscreen: false,
    until: 0,
  });
  const stepRef = useRef(0);
  stepRef.current = step;

  const go = useCallback(
    (n) => {
      const next = (n + STEPS.length) % STEPS.length;
      if (next === stepRef.current) return;
      elapsed.current = 0;
      setPrev(reduced ? null : stepRef.current);
      setStep(next);
    },
    [reduced],
  );

  // Scale the 1440x900 app to the frame (the site also does it before first paint).
  useEffect(() => {
    const el = frameRef.current;
    if (!el) return undefined;
    const fit = () =>
      el.clientWidth &&
      el.style.setProperty("--hx-s", String(el.clientWidth / 1440));
    fit();
    const ro = new ResizeObserver(fit);
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Off screen: the timer waits.
  useEffect(() => {
    const io = new IntersectionObserver(
      ([e]) => {
        pause.current.offscreen = !e.isIntersecting;
      },
      { threshold: 0.25 },
    );
    io.observe(rootRef.current);
    return () => io.disconnect();
  }, []);

  // The timer and the dash fill.
  useEffect(() => {
    const paint = () =>
      fills.current.forEach((el, i) => {
        if (!el) return;
        const cur = stepRef.current;
        const p = reduced
          ? i === cur
            ? 1
            : 0
          : i < cur
            ? 1
            : i === cur
              ? Math.min(1, elapsed.current / STEPS[cur].ms)
              : 0;
        el.style.transform = `scaleX(${p})`;
      });
    if (reduced) {
      paint();
      return undefined;
    }
    let raf = 0;
    let last = 0;
    const tick = (now) => {
      const dt = last ? Math.min(now - last, 100) : 0;
      last = now;
      const ps = pause.current;
      const paused =
        ps.hover ||
        ps.focus ||
        ps.offscreen ||
        document.hidden ||
        now < ps.until;
      rootRef.current?.toggleAttribute("data-paused", paused);
      if (!paused) {
        elapsed.current += dt;
        if (elapsed.current >= STEPS[stepRef.current].ms)
          go(stepRef.current + 1);
      }
      paint();
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [reduced, go]);

  const onKey = (e) => {
    if (e.target.closest?.(".hx")) return;
    if (e.key === "ArrowRight") go(stepRef.current + 1);
    if (e.key === "ArrowLeft") go(stepRef.current - 1);
  };
  const interact = () => {
    pause.current.until = performance.now() + INTERACT_PAUSE_MS;
  };
  const cur = STEPS[step];
  return (
    <div className="hxt" ref={rootRef} onKeyDown={onKey}>
      <div className="hxt-stage">
        <button
          type="button"
          className="hxt-arrow prev"
          aria-label="Previous step"
          onClick={() => go(step - 1)}
        >
          <CaretLeft size={20} />
        </button>
        <div
          className="hx-frame"
          data-hx-frame
          ref={frameRef}
          role="group"
          aria-label={`Agenta app: ${cur.title}`}
          onPointerEnter={(e) => {
            if (e.pointerType === "mouse") pause.current.hover = true;
          }}
          onPointerLeave={(e) => {
            if (e.pointerType === "mouse") pause.current.hover = false;
          }}
          onPointerDown={interact}
          onKeyDown={interact}
          onFocus={() => {
            pause.current.focus = true;
          }}
          onBlur={(e) => {
            if (!e.currentTarget.contains(e.relatedTarget))
              pause.current.focus = false;
          }}
        >
          {prev !== null ? (
            <div
              className="hxt-layer out"
              key={STEPS[prev].preset}
              onAnimationEnd={(e) =>
                e.target === e.currentTarget && setPrev(null)
              }
              aria-hidden="true"
              inert
            >
              <HeroApp
                preset={STEPS[prev].preset}
                autoType={STEPS[prev].preset === "build"}
              />
            </div>
          ) : null}
          <div
            className={`hxt-layer${prev !== null ? " in" : ""}`}
            key={cur.preset}
          >
            <HeroApp preset={cur.preset} autoType={cur.preset === "build"} />
          </div>
        </div>
        <button
          type="button"
          className="hxt-arrow next"
          aria-label="Next step"
          onClick={() => go(step + 1)}
        >
          <CaretRight size={20} />
        </button>
      </div>
      <div className="hxt-dashes" role="tablist" aria-label="Tour steps">
        {STEPS.map((s, i) => (
          <button
            key={s.preset}
            type="button"
            role="tab"
            aria-selected={i === step}
            aria-label={`Step ${i + 1}: ${s.title}`}
            className={i === step ? "on" : ""}
            onClick={() => {
              elapsed.current = 0;
              if (i !== step) go(i);
            }}
          >
            <i ref={(el) => (fills.current[i] = el)} />
          </button>
        ))}
      </div>
      <p className="hxt-title" aria-live="polite">
        {cur.title}
      </p>
    </div>
  );
}

// The builder page hero, the "Strand ribbon": a WebGL ring of 13 thin lines that slowly morphs.
// Ported without changes to the maths from web/mobile/src/features/builder-page/hero on main
// (BuilderHero.tsx, heroEngine.ts, heroMotion.ts, heroTheme.ts, strandRibbonRenderer.ts,
// strandRibbonShader.ts). Only the theme read differs: the site marks dark mode with
// [data-theme="dark"] instead of the app's .dark class.
import {
  forwardRef,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";

/* ---------- heroMotion.ts ---------- */
const HERO_STATE_PARAMS = {
  idle: { speed: 0.22, energy: 0.3, think: 0, done: 0 },
  typing: { speed: 0.42, energy: 0.55, think: 0, done: 0 },
  thinking: { speed: 0.75, energy: 0.75, think: 1, done: 0 },
  done: { speed: 0.1, energy: 0.12, think: 0, done: 1 },
};
const KEYS = ["speed", "energy", "think", "done"];
const SPRING_W = (2 * Math.PI) / 0.9;
const PULSE_W = (2 * Math.PI) / 0.35;
const PULSE_DAMPING = 1.2;
const PULSE_IMPULSE = 6;
const START_PHASE = 3.7;

const createMotion = (state) => ({
  state,
  params: { ...HERO_STATE_PARAMS[state] },
  velocity: { speed: 0, energy: 0, think: 0, done: 0 },
  pulse: 0,
  pulseVelocity: 0,
  phase: START_PHASE,
  time: 0,
});
function stepMotion(m, dt) {
  const target = HERO_STATE_PARAMS[m.state];
  for (const k of KEYS) {
    const a =
      SPRING_W * SPRING_W * (target[k] - m.params[k]) -
      2 * SPRING_W * m.velocity[k];
    m.velocity[k] += a * dt;
    m.params[k] += m.velocity[k] * dt;
  }
  const ap =
    -PULSE_W * PULSE_W * m.pulse - PULSE_DAMPING * PULSE_W * m.pulseVelocity;
  m.pulseVelocity += ap * dt;
  m.pulse += m.pulseVelocity * dt;
  m.phase += dt * m.params.speed;
  m.time += dt;
}
function snapMotion(m) {
  m.params = { ...HERO_STATE_PARAMS[m.state] };
  m.velocity = { speed: 0, energy: 0, think: 0, done: 0 };
  m.pulse = 0;
  m.pulseVelocity = 0;
}

/* ---------- heroTheme.ts ---------- */
const LIGHT_INKS = { ink: [36, 36, 36], ink2: [103, 103, 112], gain: 1 };
const DARK_GAIN = 1.5;
function parseCssColor(value) {
  const v = value.trim().toLowerCase();
  const hex = /^#([0-9a-f]{3,4}|[0-9a-f]{6}|[0-9a-f]{8})$/.exec(v);
  if (hex) {
    const h = hex[1].length <= 4 ? hex[1].replace(/./g, "$&$&") : hex[1];
    const n = (i) => parseInt(h.slice(i, i + 2), 16);
    return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
  }
  const fn = /^rgba?\(([^)]+)\)$/.exec(v);
  if (!fn) return null;
  const [r, g, b, a = 1] = fn[1].split(",").map(Number);
  const out = [r, g, b, a];
  return out.every(Number.isFinite) ? out : null;
}
const over = (fg, bg) =>
  [0, 1, 2].map((i) => Math.round(fg[i] * fg[3] + bg[i] * (1 - fg[3])));
function readHeroInks(el) {
  const style = getComputedStyle(el);
  const read = (name) => parseCssColor(style.getPropertyValue(name));
  const dark = el.closest('[data-theme="dark"]') !== null;
  const bg = read("--colorBgContainer") ?? [255, 255, 255, 1];
  const ink = read(dark ? "--colorTextLightSolid" : "--colorText");
  const ink2 = read(dark ? "--colorText" : "--colorTextSecondary");
  return {
    ink: ink ? over(ink, bg) : LIGHT_INKS.ink,
    ink2: ink2 ? over(ink2, bg) : LIGHT_INKS.ink2,
    gain: dark ? DARK_GAIN : 1,
  };
}

/* ---------- strandRibbonShader.ts ---------- */
const VERTEX = "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}";
const FRAGMENT = `
precision highp float;
uniform vec2 u_res;
uniform float u_phase, u_time, u_energy, u_think, u_done, u_pulse;
uniform vec3 u_ink, u_ink2;
uniform float u_gain;
#define PI 3.14159265
#define TAU 6.2831853
vec2 P() { return (2.0 * gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y); }
float PX() { return 2.0 / min(u_res.x, u_res.y); }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
void out4(vec3 col, float a) {
  float d = (hash(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  a = clamp(a + d, 0.0, 1.0);
  gl_FragColor = vec4(clamp(col + d, 0.0, 1.0) * a, a);
}
void main() {
  vec2 p = P();
  float r = length(p);
  if (abs(r - 0.56) > 0.24) { gl_FragColor = vec4(0.0); return; }
  float a = atan(p.y, p.x), px = PX();
  float t = u_phase * 5.5 * 1.25;
  float calm = 1.0 - 0.85 * u_done;
  float bl = 0.5 + 0.5 * sin(t * 0.33);
  float f5 = 5.0 * (a + t * 0.18), f6 = 6.0 * (a - t * 0.13 + 0.4);
  float A = 0.026 * calm;
  float R = 0.56 + A * ((1.0 - bl) * (cos(f5) + 0.22 * cos(2.0 * f5)) + bl * (cos(f6) + 0.22 * cos(2.0 * f6)))
          + 0.018 * sin(3.0 * a + t * 0.41) * calm + 0.012 * u_pulse;
  float dR = -A * ((1.0 - bl) * 5.0 * (sin(f5) + 0.44 * sin(2.0 * f5)) + bl * 6.0 * (sin(f6) + 0.44 * sin(2.0 * f6)))
           + 0.054 * cos(3.0 * a + t * 0.41) * calm;
  float phi = a + t * 0.75 + 1.1 * sin(a - t * 0.35);
  float dphi = 1.0 + 1.1 * cos(a - t * 0.35);
  float W = (0.085 + 0.02 * u_energy) * (1.0 - 0.8 * u_done);
  float c = cos(phi), sn = sin(phi), dc = -sn * dphi;
  float acc = 0.0, dep = 0.0;
  const int N = 13;
  for (int i = 0; i < N; i++) {
    float s = float(i) / float(N - 1) * 2.0 - 1.0;
    float dr = 0.005 * sin(5.0 * a + t * 0.28 + s * 2.0) * calm;
    float rl = R + s * W * c + dr;
    float slope = (dR + s * W * dc) / max(rl, 0.1);
    float d = abs(r - rl) * inversesqrt(1.0 + slope * slope);
    float cov = 1.0 - smoothstep(0.2 * px, 1.0 * px, d);
    float near = 0.5 + 0.5 * s * sn;
    float wgt = (0.42 + 0.58 * pow(abs(s), 6.0)) * mix(0.35, 1.0, near);
    acc += cov * wgt;
    dep += cov * wgt * near;
  }
  float nearAvg = dep / max(acc, 1e-4);
  float ad = mod(t * 0.5 - a + PI, TAU) - PI;
  float run = u_think * (ad > 0.0 ? exp(-ad * 1.3) : exp(-(ad / 0.15) * (ad / 0.15)));
  float al = 1.0 - exp(-acc * 0.85 * u_gain * (1.0 + 1.3 * run));
  out4(mix(u_ink2, u_ink, clamp(nearAvg + run, 0.0, 1.0)), al);
}
`;
const UNIFORMS = [
  "res",
  "phase",
  "time",
  "energy",
  "think",
  "done",
  "pulse",
  "ink",
  "ink2",
  "gain",
];

/* ---------- strandRibbonRenderer.ts ---------- */
function createRenderer(canvas) {
  const gl = canvas.getContext("webgl", {
    alpha: true,
    antialias: false,
    premultipliedAlpha: true,
    powerPreference: "low-power",
  });
  if (!gl || gl.isContextLost()) return null;
  const compile = (type, src) => {
    const s = gl.createShader(type);
    if (!s) return null;
    gl.shaderSource(s, src);
    gl.compileShader(s);
    if (gl.getShaderParameter(s, gl.COMPILE_STATUS)) return s;
    gl.deleteShader(s);
    return null;
  };
  const vs = compile(gl.VERTEX_SHADER, VERTEX);
  const fs = compile(gl.FRAGMENT_SHADER, FRAGMENT);
  const program = vs && fs ? gl.createProgram() : null;
  if (program) {
    gl.attachShader(program, vs);
    gl.attachShader(program, fs);
    gl.bindAttribLocation(program, 0, "a");
    gl.linkProgram(program);
  }
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!program || !gl.getProgramParameter(program, gl.LINK_STATUS)) {
    gl.deleteProgram(program);
    return null;
  }
  gl.useProgram(program);
  const buffer = gl.createBuffer();
  gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
  gl.bufferData(
    gl.ARRAY_BUFFER,
    new Float32Array([-1, -1, 3, -1, -1, 3]),
    gl.STATIC_DRAW,
  );
  gl.enableVertexAttribArray(0);
  gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
  const u = Object.fromEntries(
    UNIFORMS.map((n) => [n, gl.getUniformLocation(program, `u_${n}`)]),
  );
  return {
    draw(m, inks) {
      const { width, height } = canvas;
      gl.viewport(0, 0, width, height);
      gl.clearColor(0, 0, 0, 0);
      gl.clear(gl.COLOR_BUFFER_BIT);
      gl.uniform2f(u.res, width, height);
      gl.uniform1f(u.phase, m.phase);
      gl.uniform1f(u.time, m.time);
      gl.uniform1f(u.energy, m.params.energy);
      gl.uniform1f(u.think, m.params.think);
      gl.uniform1f(u.done, m.params.done);
      gl.uniform1f(u.pulse, m.pulse);
      gl.uniform3f(
        u.ink,
        inks.ink[0] / 255,
        inks.ink[1] / 255,
        inks.ink[2] / 255,
      );
      gl.uniform3f(
        u.ink2,
        inks.ink2[0] / 255,
        inks.ink2[1] / 255,
        inks.ink2[2] / 255,
      );
      gl.uniform1f(u.gain, inks.gain);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose() {
      gl.deleteBuffer(buffer);
      gl.deleteProgram(program);
      gl.getExtension("WEBGL_lose_context")?.loseContext();
    },
  };
}

/* ---------- heroEngine.ts ---------- */
const MAX_PIXEL_RATIO = 2;
const MAX_STEP = 1 / 20;

class HeroEngine {
  constructor(canvas, { state, onFallback }) {
    this.canvas = canvas;
    this.onFallback = onFallback;
    this.motion = createMotion(state);
    this.reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
    this.inks = readHeroInks(canvas);
    this.renderer = createRenderer(canvas);
    this.raf = 0;
    this.last = 0;
    this.onScreen = true;
    this.cleanups = [];
    onFallback(!this.renderer);
    this.wake = this.wake.bind(this);
    this.loop = this.loop.bind(this);
    this.listen(document, "visibilitychange", this.wake);
    this.listen(this.reducedMotion, "change", this.wake);
    this.listen(canvas, "webglcontextlost", (e) => {
      e.preventDefault();
      this.stop();
      this.renderer = null;
      this.onFallback(true);
    });
    const themeObserver = new MutationObserver(() => {
      this.inks = readHeroInks(this.canvas);
      if (!this.raf) this.draw();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ["class", "data-theme"],
    });
    this.cleanups.push(() => themeObserver.disconnect());
    if (typeof IntersectionObserver !== "undefined") {
      const io = new IntersectionObserver((entries) => {
        this.onScreen = entries[entries.length - 1].isIntersecting;
        this.wake();
      });
      io.observe(canvas);
      this.cleanups.push(() => io.disconnect());
    }
    if (typeof ResizeObserver !== "undefined") {
      const ro = new ResizeObserver(() => {
        if (!this.raf) this.draw();
      });
      ro.observe(canvas);
      this.cleanups.push(() => ro.disconnect());
    }
    this.draw();
    this.wake();
  }
  get running() {
    return this.raf !== 0;
  }
  setState(state) {
    if (state === this.motion.state) return;
    this.motion.state = state;
    this.wake();
  }
  pulse() {
    if (!this.canAnimate()) return;
    this.motion.pulseVelocity += PULSE_IMPULSE;
    this.wake();
  }
  destroy() {
    this.stop();
    this.cleanups.forEach((fn) => fn());
    this.cleanups.length = 0;
    this.renderer?.dispose();
    this.renderer = null;
  }
  canAnimate() {
    return (
      !!this.renderer &&
      this.onScreen &&
      !document.hidden &&
      !this.reducedMotion.matches
    );
  }
  wake() {
    if (this.reducedMotion.matches) {
      this.stop();
      snapMotion(this.motion);
      this.draw();
      return;
    }
    if (!this.canAnimate()) {
      this.stop();
      return;
    }
    if (!this.raf) {
      this.last = 0;
      this.raf = requestAnimationFrame(this.loop);
    }
  }
  stop() {
    if (this.raf) cancelAnimationFrame(this.raf);
    this.raf = 0;
  }
  loop(now) {
    this.raf = 0;
    if (!this.canAnimate()) return;
    const dt = this.last
      ? Math.min((now - this.last) / 1000, MAX_STEP)
      : 1 / 60;
    this.last = now;
    stepMotion(this.motion, dt);
    this.draw();
    this.raf = requestAnimationFrame(this.loop);
  }
  draw() {
    if (!this.renderer) return;
    const ratio = Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO);
    const w = Math.max(1, Math.round(this.canvas.clientWidth * ratio));
    const h = Math.max(1, Math.round(this.canvas.clientHeight * ratio));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.renderer.draw(this.motion, this.inks);
  }
  listen(target, type, handler) {
    target.addEventListener(type, handler);
    this.cleanups.push(() => target.removeEventListener(type, handler));
  }
}

/** BuilderHero.tsx: the canvas, with the three activity dots when WebGL is missing. */
export const BuilderRing = forwardRef(function BuilderRing(
  { state, size = 180 },
  ref,
) {
  const canvasRef = useRef(null);
  const engineRef = useRef(null);
  const initialState = useRef(state);
  const [fallback, setFallback] = useState(false);
  useEffect(() => {
    const engine = new HeroEngine(canvasRef.current, {
      state: initialState.current,
      onFallback: setFallback,
    });
    engineRef.current = engine;
    return () => {
      engine.destroy();
      engineRef.current = null;
    };
  }, []);
  useEffect(() => {
    engineRef.current?.setState(state);
  }, [state]);
  useImperativeHandle(
    ref,
    () => ({ pulse: () => engineRef.current?.pulse() }),
    [],
  );
  return (
    <div
      aria-hidden="true"
      data-hero-state={state}
      className="hx-ring"
      style={{ width: size, height: size }}
    >
      <canvas
        ref={canvasRef}
        style={fallback ? { visibility: "hidden" } : undefined}
      />
      {fallback ? (
        <svg viewBox="-100 -100 200 200" className="hx-ringfb">
          {[-30, 0, 30].map((x) => (
            <circle key={x} cx={x} cy={0} r={9} fill="currentColor" />
          ))}
        </svg>
      ) : null}
    </div>
  );
});

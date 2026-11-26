/**
 * The "Strand ribbon" hero shader (WebGL 1): 13 thin gray lines twist around a ring.
 * Ported from the animation design gallery (prelude.glsl + v-strandribbon.js).
 * The engine feeds the uniforms; see heroEngine.ts for what each one means.
 */

export const STRAND_RIBBON_VERTEX_SHADER =
    "attribute vec2 a;void main(){gl_Position=vec4(a,0.,1.);}"

// Shared shader code: coordinates, a hash, and the dithered output.
const PRELUDE = `
precision highp float;
uniform vec2 u_res;
uniform float u_phase, u_time, u_energy, u_think, u_done, u_pulse;
uniform vec3 u_ink, u_ink2;
uniform float u_gain;
#define PI 3.14159265
#define TAU 6.2831853
// Centered coordinates: the short side runs from -1 to 1.
vec2 P() { return (2.0 * gl_FragCoord.xy - u_res) / min(u_res.x, u_res.y); }
// Size of one device pixel in P() units.
float PX() { return 2.0 / min(u_res.x, u_res.y); }
float hash(vec2 p) { vec3 q = fract(vec3(p.xyx) * .1031); q += dot(q, q.yzx + 33.33); return fract((q.x + q.y) * q.z); }
// Writes a color with coverage a. Adds 1/255 of noise to stop banding in soft gradients.
void out4(vec3 col, float a) {
  float d = (hash(gl_FragCoord.xy + fract(u_time) * 97.0) - 0.5) / 255.0;
  a = clamp(a + d, 0.0, 1.0);
  gl_FragColor = vec4(clamp(col + d, 0.0, 1.0) * a, a);
}
`

// The ring shape is a sum of smooth waves, so it has soft corners but no sharp kinks.
// Each line has its own depth: lines nearer the viewer are darker, lines further away are lighter.
const STRAND_RIBBON_MAIN = `
void main() {
  vec2 p = P();
  float r = length(p);
  if (abs(r - 0.56) > 0.24) { gl_FragColor = vec4(0.0); return; }
  float a = atan(p.y, p.x), px = PX();
  float t = u_phase * 5.5 * 1.25;
  float calm = 1.0 - 0.85 * u_done;
  // Center curve: five and six soft corners, made of smooth waves that turn at different speeds.
  float bl = 0.5 + 0.5 * sin(t * 0.33);
  float f5 = 5.0 * (a + t * 0.18), f6 = 6.0 * (a - t * 0.13 + 0.4);
  float A = 0.026 * calm;
  float R = 0.56 + A * ((1.0 - bl) * (cos(f5) + 0.22 * cos(2.0 * f5)) + bl * (cos(f6) + 0.22 * cos(2.0 * f6)))
          + 0.018 * sin(3.0 * a + t * 0.41) * calm + 0.012 * u_pulse;
  float dR = -A * ((1.0 - bl) * 5.0 * (sin(f5) + 0.44 * sin(2.0 * f5)) + bl * 6.0 * (sin(f6) + 0.44 * sin(2.0 * f6)))
           + 0.054 * cos(3.0 * a + t * 0.41) * calm;
  // Twist: two folds that slide along the ring.
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
    // Depth of this line: the part of the ribbon that leans toward the viewer is near (1), away is far (0).
    float near = 0.5 + 0.5 * s * sn;
    // The first and last lines are darker; the lines between them stay light.
    float wgt = (0.42 + 0.58 * pow(abs(s), 6.0)) * mix(0.35, 1.0, near);
    acc += cov * wgt;
    dep += cov * wgt * near;
  }
  float nearAvg = dep / max(acc, 1e-4);
  // Thinking: one darker run that travels around the ring.
  float ad = mod(t * 0.5 - a + PI, TAU) - PI;
  float run = u_think * (ad > 0.0 ? exp(-ad * 1.3) : exp(-(ad / 0.15) * (ad / 0.15)));
  float al = 1.0 - exp(-acc * 0.85 * u_gain * (1.0 + 1.3 * run));
  out4(mix(u_ink2, u_ink, clamp(nearAvg + run, 0.0, 1.0)), al);
}
`

export const STRAND_RIBBON_FRAGMENT_SHADER = PRELUDE + STRAND_RIBBON_MAIN

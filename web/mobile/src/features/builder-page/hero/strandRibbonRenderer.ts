import type {HeroMotion} from "./heroMotion"
import type {HeroInks} from "./heroTheme"
import {HERO_FRAGMENT_SHADER, HERO_VERTEX_SHADER} from "./strandRibbonShader"

export interface HeroRenderer {
    /** Draws one frame at the canvas size. */
    draw(motion: HeroMotion, inks: HeroInks): void
    /** Frees the GPU objects. */
    dispose(): void
}

const UNIFORMS = ["res", "phase", "time", "energy", "think", "done", "kick", "ink", "ink2"] as const

/**
 * Compiles the Strand ribbon shader on the canvas. Returns null when the browser has no WebGL
 * or the shader does not compile, so the caller shows the still fallback.
 */
export function createStrandRibbonRenderer(canvas: HTMLCanvasElement): HeroRenderer | null {
    const gl = canvas.getContext("webgl", {
        alpha: true,
        antialias: false,
        premultipliedAlpha: true,
        powerPreference: "low-power",
    })
    if (!gl || gl.isContextLost()) return null

    const compile = (type: number, src: string) => {
        const s = gl.createShader(type)
        if (!s) return null
        gl.shaderSource(s, src)
        gl.compileShader(s)
        return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? s : null
    }
    const vs = compile(gl.VERTEX_SHADER, HERO_VERTEX_SHADER)
    const fs = compile(gl.FRAGMENT_SHADER, HERO_FRAGMENT_SHADER)
    const program = gl.createProgram()
    if (!vs || !fs || !program) return null
    gl.attachShader(program, vs)
    gl.attachShader(program, fs)
    gl.linkProgram(program)
    gl.deleteShader(vs)
    gl.deleteShader(fs)
    if (!gl.getProgramParameter(program, gl.LINK_STATUS)) return null
    gl.useProgram(program)

    // One triangle that covers the whole canvas.
    const buffer = gl.createBuffer()
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer)
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 3, -1, -1, 3]), gl.STATIC_DRAW)
    gl.enableVertexAttribArray(0)
    gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0)

    const u = Object.fromEntries(
        UNIFORMS.map((n) => [n, gl.getUniformLocation(program, `u_${n}`)]),
    ) as Record<(typeof UNIFORMS)[number], WebGLUniformLocation | null>

    return {
        draw(m, inks) {
            const {width, height} = canvas
            gl.viewport(0, 0, width, height)
            gl.clearColor(0, 0, 0, 0)
            gl.clear(gl.COLOR_BUFFER_BIT)
            gl.uniform2f(u.res, width, height)
            gl.uniform1f(u.phase, m.phase)
            gl.uniform1f(u.time, m.time)
            gl.uniform1f(u.energy, m.params.energy)
            gl.uniform1f(u.think, m.params.think)
            gl.uniform1f(u.done, m.params.done)
            gl.uniform1f(u.kick, m.kick)
            gl.uniform3f(u.ink, inks.ink[0] / 255, inks.ink[1] / 255, inks.ink[2] / 255)
            gl.uniform3f(u.ink2, inks.ink2[0] / 255, inks.ink2[1] / 255, inks.ink2[2] / 255)
            gl.drawArrays(gl.TRIANGLES, 0, 3)
        },
        dispose() {
            gl.deleteBuffer(buffer)
            gl.deleteProgram(program)
        },
    }
}

import {useEffect, useRef, type RefObject} from "react"

/**
 * Rolling voice waveform: each slice is the FFT magnitude of one moment, appended on the right so
 * the take scrolls leftward as it is spoken — the shape of what was said, not a bare level meter.
 *
 * Drawn on a canvas from the animation frame, so the whole visualisation costs ZERO React renders
 * (state for it would repaint its parent at frame rate).
 */

/** Slices kept on screen. */
const HISTORY = 64
/** How often a new slice is captured. ~14/s scrolls readably without smearing. */
const APPEND_MS = 70
/** Ignore the top of the spectrum — mostly hiss, and it flattens the voice band. */
const VOICE_BAND = 0.55
/** Speech rarely pins the analyser, so lift the range into something legible. */
const GAIN = 2.2

type RoundRectCtx = CanvasRenderingContext2D & {
    roundRect?: (x: number, y: number, w: number, h: number, radii: number) => void
}

const RecordingWaveform = ({
    analyserRef,
    className,
}: {
    analyserRef: RefObject<AnalyserNode | null>
    className?: string
}) => {
    const canvasRef = useRef<HTMLCanvasElement>(null)
    const historyRef = useRef<number[]>(new Array(HISTORY).fill(0))
    const lastAppendRef = useRef(0)

    useEffect(() => {
        const canvas = canvasRef.current
        const ctx = canvas?.getContext("2d")
        if (!canvas || !ctx) return

        let raf = 0
        // Explicit buffer type: a bare `Uint8Array` widens to `ArrayBufferLike`, which the
        // analyser's typed signature rejects.
        let spectrum: Uint8Array<ArrayBuffer> | null = null
        // Resolved once per resize rather than per frame — reading computed style is a style
        // recalculation, and this runs 60x a second.
        let colour = "currentColor"

        const resize = () => {
            const dpr = window.devicePixelRatio || 1
            canvas.width = Math.max(1, Math.floor(canvas.clientWidth * dpr))
            canvas.height = Math.max(1, Math.floor(canvas.clientHeight * dpr))
            ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
            colour = getComputedStyle(canvas).color
        }
        resize()
        const observer = new ResizeObserver(resize)
        observer.observe(canvas)

        const draw = () => {
            const analyser = analyserRef.current
            const now = Date.now()

            if (analyser && now - lastAppendRef.current >= APPEND_MS) {
                lastAppendRef.current = now
                if (!spectrum || spectrum.length !== analyser.frequencyBinCount) {
                    spectrum = new Uint8Array(analyser.frequencyBinCount)
                }
                analyser.getByteFrequencyData(spectrum)
                const bins = Math.max(1, Math.floor(spectrum.length * VOICE_BAND))
                let sum = 0
                for (let i = 0; i < bins; i++) sum += spectrum[i]
                const magnitude = Math.min(1, (sum / bins / 255) * GAIN)
                historyRef.current.push(magnitude)
                historyRef.current.shift()
            }

            const width = canvas.clientWidth
            const height = canvas.clientHeight
            const mid = height / 2
            const gap = 2
            const barWidth = Math.max(1, (width - gap * (HISTORY - 1)) / HISTORY)
            const radius = barWidth / 2
            const rounded = ctx as RoundRectCtx

            ctx.clearRect(0, 0, width, height)
            ctx.fillStyle = colour
            for (let i = 0; i < HISTORY; i++) {
                const barHeight = Math.max(2, historyRef.current[i] * (height - 2))
                const x = i * (barWidth + gap)
                const y = mid - barHeight / 2
                // Older slices recede, so the newest edge reads as "now".
                ctx.globalAlpha = 0.2 + (i / (HISTORY - 1)) * 0.8
                ctx.beginPath()
                if (rounded.roundRect) rounded.roundRect(x, y, barWidth, barHeight, radius)
                else ctx.rect(x, y, barWidth, barHeight)
                ctx.fill()
            }
            ctx.globalAlpha = 1

            raf = requestAnimationFrame(draw)
        }
        raf = requestAnimationFrame(draw)

        return () => {
            cancelAnimationFrame(raf)
            observer.disconnect()
        }
    }, [analyserRef])

    return <canvas ref={canvasRef} aria-hidden className={`h-8 w-full ${className ?? ""}`} />
}

export default RecordingWaveform

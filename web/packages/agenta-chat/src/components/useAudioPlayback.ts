import {useEffect, useRef, useState} from "react"

/** Play/pause for one `<audio>` element: attach `ref` to it, call `toggle` from a control. */
export function useAudioPlayback(src?: string) {
    const ref = useRef<HTMLAudioElement>(null)
    const [playing, setPlaying] = useState(false)

    useEffect(() => {
        const el = ref.current
        if (!el) return
        const onPlay = () => setPlaying(true)
        const onStop = () => setPlaying(false)
        el.addEventListener("play", onPlay)
        el.addEventListener("pause", onStop)
        el.addEventListener("ended", onStop)
        return () => {
            el.removeEventListener("play", onPlay)
            el.removeEventListener("pause", onStop)
            el.removeEventListener("ended", onStop)
        }
        // The <audio> only mounts once a src arrives, so a mount-only effect would run while the
        // ref is still null and never attach.
    }, [src])

    const toggle = () => {
        const el = ref.current
        if (!el) return
        if (el.paused) void el.play()
        else el.pause()
    }

    return {ref, playing, toggle}
}

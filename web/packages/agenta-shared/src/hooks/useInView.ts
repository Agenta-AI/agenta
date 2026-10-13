import {useEffect, useRef, useState} from "react"

/** Latches true once the element comes within `rootMargin` of the viewport; never resets. */
export function useInView<T extends HTMLElement>(rootMargin = "200px") {
    const ref = useRef<T>(null)
    const [inView, setInView] = useState(false)
    useEffect(() => {
        if (inView) return
        const el = ref.current
        if (!el) return
        const io = new IntersectionObserver(
            (entries) => {
                if (entries.some((e) => e.isIntersecting)) setInView(true)
            },
            {rootMargin},
        )
        io.observe(el)
        return () => io.disconnect()
    }, [inView, rootMargin])
    return [ref, inView] as const
}

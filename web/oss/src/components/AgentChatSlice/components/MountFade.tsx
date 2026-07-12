import {useEffect, useState} from "react"

/**
 * Fades its children in one frame after mount (OPACITY ONLY, so it can't shift layout) — used to
 * ease a lazily-hydrated region in over its skeleton instead of a hard Suspense pop. Honors
 * reduced motion: the initial transparency and the transition are both `motion-safe`, so it's
 * instant-visible otherwise.
 */
const MountFade = ({className, children}: {className?: string; children: React.ReactNode}) => {
    const [shown, setShown] = useState(false)
    useEffect(() => {
        const raf = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(raf)
    }, [])
    return (
        <div
            className={`motion-safe:transition-opacity motion-safe:duration-200 motion-safe:ease-out ${
                shown ? "opacity-100" : "motion-safe:opacity-0"
            } ${className ?? ""}`}
        >
            {children}
        </div>
    )
}

export default MountFade

import {useEffect, useState} from "react"

/** False on the first paint when `animate`, true a frame later — the hook behind a fade-in. */
export const useRevealed = (animate: boolean): boolean => {
    const [shown, setShown] = useState(!animate)
    useEffect(() => {
        if (shown) return
        const id = requestAnimationFrame(() => setShown(true))
        return () => cancelAnimationFrame(id)
    }, [shown])
    return shown
}

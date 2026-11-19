import {useEffect} from "react"

/** Turns a shown flag off on the next pointer press anywhere on the page. */
export const useClearOnNextPress = (shown: boolean, setShown: (next: boolean) => void) => {
    useEffect(() => {
        if (!shown) return
        const clear = () => setShown(false)
        document.addEventListener("pointerdown", clear, {once: true})
        return () => document.removeEventListener("pointerdown", clear)
    }, [shown, setShown])
}

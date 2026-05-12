import {useMemo} from "react"

export function useModifierKey(): string {
    return useMemo(() => {
        if (typeof navigator === "undefined") return "Ctrl"
        return /Mac|iPhone|iPad|iPod/i.test(navigator.platform) ? "⌘" : "Ctrl"
    }, [])
}

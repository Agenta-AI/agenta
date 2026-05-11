import {useEffect} from "react"

export interface UseRunAllShortcutParams {
    isRunning: boolean
    canRun?: boolean
    onRun: () => void
}

export function useRunAllShortcut({isRunning, canRun = true, onRun}: UseRunAllShortcutParams) {
    useEffect(() => {
        const listener = (e: KeyboardEvent) => {
            if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
                e.preventDefault()
                e.stopPropagation()
                if (!isRunning && canRun) onRun()
            }
        }

        document.addEventListener("keydown", listener, true)
        return () => {
            document.removeEventListener("keydown", listener, true)
        }
    }, [onRun, isRunning, canRun])
}

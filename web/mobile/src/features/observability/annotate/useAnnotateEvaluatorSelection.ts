import {useCallback, useState} from "react"

/** The old app's key, so a user keeps the same picked evaluators in both apps. */
const storageKey = (projectId: string) => `${projectId}-evaluator`

const readSelection = (projectId: string): string[] => {
    try {
        const parsed: unknown = JSON.parse(
            window.localStorage.getItem(storageKey(projectId)) ?? "[]",
        )
        return Array.isArray(parsed) && parsed.every((item) => typeof item === "string")
            ? parsed
            : []
    } catch {
        return []
    }
}

/**
 * The evaluators the user picked to annotate with, by slug, kept per project in local storage.
 * Storage that cannot be read or written only loses the memory, never the current choice.
 */
export const useAnnotateEvaluatorSelection = (projectId: string) => {
    const [selected, setSelectedState] = useState(() => readSelection(projectId))

    const setSelected = useCallback(
        (next: string[]) => {
            setSelectedState(next)
            try {
                window.localStorage.setItem(storageKey(projectId), JSON.stringify(next))
            } catch {
                // Blocked storage: the choice still holds until the sheet closes.
            }
        },
        [projectId],
    )

    return {selected, setSelected}
}

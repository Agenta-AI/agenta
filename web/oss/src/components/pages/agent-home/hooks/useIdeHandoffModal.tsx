import {useCallback, useState} from "react"

import ContinueInIdeModal from "../components/ContinueInIdeModal"

/**
 * Controller for the IDE-handoff modal (the default "Continue in IDE" behavior). `openWith(prompt)`
 * opens it with the given composer text; render `node` once in the page.
 */
export function useIdeHandoffModal() {
    const [open, setOpen] = useState(false)
    const [prompt, setPrompt] = useState("")

    const openWith = useCallback((next: string) => {
        setPrompt(next)
        setOpen(true)
    }, [])

    const node = <ContinueInIdeModal open={open} prompt={prompt} onClose={() => setOpen(false)} />

    return {openWith, node}
}

import {useCallback, useEffect, useRef, useState} from "react"

import type {ClientToolOutputHandler} from "../clientTools/ClientToolPart"
import type {ClientToolMeta} from "../skin"

/** Client-tool calls answered here whose transcript rows have not arrived yet. */
export const useSettlingIds = (pending: ClientToolMeta[], onOutput?: ClientToolOutputHandler) => {
    const [settlingIds, setSettlingIds] = useState<ReadonlySet<string>>(() => new Set())
    // Mirrors the state for synchronous reads between renders (a double dismiss, a stale closure).
    const settlingRef = useRef<Set<string>>(new Set())

    const mark = useCallback((ids: string[]) => {
        for (const id of ids) settlingRef.current.add(id)
        setSettlingIds(new Set(settlingRef.current))
    }, [])
    const forget = useCallback((ids: string[]) => {
        for (const id of ids) settlingRef.current.delete(id)
        setSettlingIds(new Set(settlingRef.current))
    }, [])
    const isSettling = useCallback((id: string) => settlingRef.current.has(id), [])

    // The transcript caught up, so the marker has nothing left to hide.
    useEffect(() => {
        const live = new Set(pending.map((meta) => meta.toolCallId))
        const gone = [...settlingRef.current].filter((id) => !live.has(id))
        if (gone.length) forget(gone)
    }, [pending, forget])

    // Hide the card as the answer leaves; give it back only if the write never landed.
    const settle = useCallback<ClientToolOutputHandler>(
        async (args) => {
            if (!onOutput) return false
            mark([args.toolCallId])
            try {
                const landed = await onOutput(args)
                if (landed === false) forget([args.toolCallId])
                return landed
            } catch (error) {
                forget([args.toolCallId])
                throw error
            }
        },
        [onOutput, mark, forget],
    )

    return {settlingIds, mark, forget, isSettling, settle}
}

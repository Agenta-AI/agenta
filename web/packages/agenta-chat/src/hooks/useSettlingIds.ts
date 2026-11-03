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

    /**
     * Settle every target from outside the cards, as their own decline would. Resolves with the
     * calls it settled once every write lands; rejects, and gives the cards back, when one fails,
     * whether the handler threw or reported `false`. A no-op without a settle channel.
     */
    const dismiss = useCallback(
        async (
            pending: ClientToolMeta[],
            output: (meta: ClientToolMeta) => Record<string, unknown>,
            failure: string,
        ): Promise<ClientToolMeta[]> => {
            // Checked before the markers go up, which would close the dock over live requests.
            if (!onOutput) return []
            const targets = pending.filter((meta) => !meta.settled && !isSettling(meta.toolCallId))
            if (targets.length === 0) return []
            const ids = targets.map((meta) => meta.toolCallId)
            mark(ids)
            try {
                const landed = await Promise.all(
                    targets.map((meta) =>
                        onOutput({
                            toolName: meta.toolName,
                            toolCallId: meta.toolCallId,
                            output: output(meta),
                        }),
                    ),
                )
                if (landed.some((result) => result === false)) throw new Error(failure)
                return targets
            } catch (error) {
                forget(ids)
                throw error
            }
        },
        [onOutput, mark, forget, isSettling],
    )

    return {settlingIds, settle, dismiss}
}

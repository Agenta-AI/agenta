/**
 * LensBody — renders the active lens, or its Raw JSON overlay (build-spec §4.4). Shared by the
 * docked Inspector and the compare-column drawer so both hosts show identical content.
 */
import {useMemo} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {ContextLens} from "./lenses/ContextLens"
import {ResponseLens} from "./lenses/ResponseLens"
import {RuntimeLens} from "./lenses/RuntimeLens"
import {TimelineLens} from "./lenses/TimelineLens"
import type {InspectorLens} from "./state"
import {buildTimeline} from "./timeline"

/** Raw JSON of the records — narrowed to the focused turn when one is focused. */
const RawView = ({sessionId, focusedTurn}: {sessionId: string; focusedTurn?: number | null}) => {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))
    const json = useMemo(() => {
        const records = query.data ?? []
        if (focusedTurn == null) return JSON.stringify(records, null, 2)
        const {turns} = buildTimeline(records)
        const ids = new Set(
            turns.find((t) => t.turn === focusedTurn)?.events.map((e) => e.id) ?? [],
        )
        return JSON.stringify(
            records.filter((r) => ids.has(r.id)),
            null,
            2,
        )
    }, [query.data, focusedTurn])
    return (
        <div className="relative min-h-0 flex-1 overflow-auto p-3">
            <div className="absolute right-4 top-4 z-[1]">
                <CopyButton text={json} />
            </div>
            <pre className="m-0 rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3 font-mono text-[11px] leading-snug text-colorTextSecondary">
                {json}
            </pre>
        </div>
    )
}

export function LensBody({
    sessionId,
    focusedTurn,
    lens,
    rawOpen,
    onDrillTurn,
}: {
    sessionId: string
    focusedTurn?: number | null
    lens: InspectorLens
    rawOpen: boolean
    onDrillTurn?: (turn: number) => void
}) {
    if (rawOpen) return <RawView sessionId={sessionId} focusedTurn={focusedTurn} />
    if (lens === "timeline")
        return (
            <TimelineLens
                sessionId={sessionId}
                focusedTurn={focusedTurn}
                onDrillTurn={onDrillTurn}
            />
        )
    if (lens === "context") return <ContextLens sessionId={sessionId} focusedTurn={focusedTurn} />
    if (lens === "response") return <ResponseLens sessionId={sessionId} />
    return <RuntimeLens sessionId={sessionId} />
}

/**
 * LensBody — renders the active lens, or its Raw JSON overlay (build-spec §4.4). Shared by the
 * docked Inspector and the compare-column drawer so both hosts show identical content.
 */
import {useMemo} from "react"

import {sessionRecordsQueryFamily} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {useAtomValue} from "jotai"

import {ContextLens} from "./lenses/ContextLens"
import {RuntimeLens} from "./lenses/RuntimeLens"
import {TimelineLens} from "./lenses/TimelineLens"
import type {InspectorLens, InspectorScope} from "./state"
import {buildTimeline} from "./timeline"

/** Raw JSON of the current scope's records (Timeline/Context source; Runtime raw = same stream). */
const RawView = ({
    sessionId,
    scope,
    targetTurn,
}: {
    sessionId: string
    scope: InspectorScope
    targetTurn?: number | null
}) => {
    const query = useAtomValue(sessionRecordsQueryFamily(sessionId))
    const json = useMemo(() => {
        const records = query.data ?? []
        if (scope !== "turn" || targetTurn == null) return JSON.stringify(records, null, 2)
        const {turns} = buildTimeline(records)
        const ids = new Set(turns.find((t) => t.turn === targetTurn)?.events.map((e) => e.id) ?? [])
        return JSON.stringify(
            records.filter((r) => ids.has(r.id)),
            null,
            2,
        )
    }, [query.data, scope, targetTurn])
    return (
        <div className="relative min-h-0 flex-1 overflow-auto p-3">
            <div className="absolute right-4 top-4 z-[1]">
                <CopyButton text={json} />
            </div>
            <pre className="m-0 rounded border border-solid border-[#24262b] bg-[#0f1012] p-3 font-mono text-[11px] leading-snug text-colorTextSecondary">
                {json}
            </pre>
        </div>
    )
}

export function LensBody({
    sessionId,
    scope,
    targetTurn,
    lens,
    rawOpen,
}: {
    sessionId: string
    scope: InspectorScope
    targetTurn?: number | null
    lens: InspectorLens
    rawOpen: boolean
}) {
    if (rawOpen) return <RawView sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
    if (lens === "timeline")
        return <TimelineLens sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
    if (lens === "context")
        return <ContextLens sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
    return <RuntimeLens sessionId={sessionId} scope={scope} />
}

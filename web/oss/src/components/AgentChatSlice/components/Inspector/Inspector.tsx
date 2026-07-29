/**
 * Inspector (build-spec §1–§7) — the single docked panel that replaces the SessionInspector
 * drawer and the Turn inspector. One shell, a Turn⇄Session scope switch, three lenses
 * (Timeline / Context / Runtime) + a Raw `{}` header toggle. Records-backed (cross-device);
 * scope only parameterises what the lenses query, never the chrome. Docks via RightPanelSplit.
 */
import {useEffect, useMemo, useState} from "react"

import {revalidateSessionRecordsAtom, sessionRecordsQueryFamily} from "@agenta/entities/session"
import {ArrowClockwise, BracketsCurly, DownloadSimple, X} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Select, Tooltip} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {downloadText} from "@/oss/lib/helpers/fileManipulations"

import {sessionLivenessAtomFamily} from "../../state/liveness"

import {invalidateSessionInspector} from "./invalidate"
import {LensBody} from "./LensBody"
import {LensRail} from "./LensRail"
import {
    closeInspectorAtom,
    inspectorLensAtom,
    inspectorRawOpenAtom,
    inspectorTargetAtom,
} from "./state"
import {buildTimeline} from "./timeline"

// Hold the data-heavy body off until the dock's open slide (RightPanelSplit, 240ms) settles:
// mounting the Timeline — parse every record + render every row — DURING the flex-basis animation
// starves frames, so the panel staggers and snaps to width at the end. A skeleton holds the space
// until then. (An empty session was always smooth: nothing heavy to mount.) 300ms = slide + buffer.
const BODY_READY_MS = 300

/** Light placeholder shown in the body while the panel slides open — matches the timeline shape
 * (filter bar + rows) so nothing shifts when the real content swaps in. Pure divs: zero record
 * work during the animation. */
const InspectorBodySkeleton = () => (
    <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorSplit px-2 py-1.5">
            <div className="h-6 w-40 rounded bg-colorFillTertiary" />
            <div className="ml-auto h-6 w-28 rounded bg-colorFillTertiary" />
        </div>
        <div className="flex min-h-0 flex-1 flex-col motion-safe:animate-pulse">
            {Array.from({length: 9}).map((_, i) => (
                <div key={i} className="flex items-center gap-2 px-2 py-[9px]">
                    <div className="h-2 w-2 shrink-0 rounded-full bg-colorFillTertiary" />
                    <div
                        className="h-3 rounded bg-colorFillTertiary"
                        style={{width: `${42 + ((i * 17) % 44)}%`}}
                    />
                    <div className="ml-auto h-3 w-10 rounded bg-colorFillTertiary" />
                </div>
            ))}
        </div>
    </div>
)

/** alive/running/attached chips on the session identity line (build-spec §3). */
const LivenessChips = ({sessionId}: {sessionId: string}) => {
    const {nest} = useAtomValue(sessionLivenessAtomFamily(sessionId))
    const chips: {label: string; color: string}[] = []
    if (nest.isAlive) chips.push({label: "alive", color: "var(--ag-colorSuccess)"})
    if (nest.isRunning) chips.push({label: "running", color: "var(--ag-colorWarning)"})
    if (nest.isAttached) chips.push({label: "attached", color: "var(--ag-colorInfo)"})
    if (chips.length === 0) chips.push({label: "dormant", color: "var(--ag-colorTextTertiary)"})
    return (
        <span className="ml-auto flex shrink-0 items-center gap-1">
            {chips.map((c) => (
                <span
                    key={c.label}
                    className="rounded px-1.5 py-px text-[10px] font-medium"
                    style={{background: "var(--ag-colorFillTertiary)", color: c.color}}
                >
                    {c.label}
                </span>
            ))}
        </span>
    )
}

export function Inspector({sessionId}: {sessionId: string}) {
    const target = useAtomValue(inspectorTargetAtom)
    const setTarget = useSetAtom(inspectorTargetAtom)
    const close = useSetAtom(closeInspectorAtom)
    const [lens, setLens] = useAtom(inspectorLensAtom)
    const [rawOpen, setRawOpen] = useAtom(inspectorRawOpenAtom)
    const revalidateRecords = useSetAtom(revalidateSessionRecordsAtom)
    const queryClient = useQueryClient()

    const active = target?.sessionId === sessionId ? target : null
    // Empty key disables the query while closed — subscribing with the real id
    // here made a closed inspector fetch 226KB of records on every cold load.
    const records = useAtomValue(sessionRecordsQueryFamily(active ? sessionId : ""))
    const focusedTurn = active?.focusedTurn ?? null

    // Gate all record-heavy work behind the open-slide settle (see BODY_READY_MS). Mount-scoped, so
    // a scope switch / drill (panel already open, no width animation) never re-flashes the skeleton.
    const [bodyReady, setBodyReady] = useState(false)
    useEffect(() => {
        const t = setTimeout(() => setBodyReady(true), BODY_READY_MS)
        return () => clearTimeout(t)
    }, [])

    // buildTimeline sorts + groups every record — deferred too, so it doesn't run mid-animation.
    const turnCount = useMemo(
        () => (bodyReady ? buildTimeline(records.data).turns.length : 0),
        [bodyReady, records.data],
    )

    if (!active) return null

    // Panel-level scope selector next to the title: Session, or a specific turn. Everything (all
    // lenses) reacts to it via `focusedTurn`. Options run 1..N; include the current focus even
    // before the turn count settles so the value always has a matching option.
    const maxTurn = Math.max(turnCount, focusedTurn ?? 0)
    const scopeOptions = [
        {value: "session", label: "Session"},
        ...Array.from({length: maxTurn}, (_, i) => ({
            value: String(i + 1),
            label: `Turn ${i + 1}`,
        })),
    ]
    const onScopeChange = (v: string) =>
        setTarget({sessionId, focusedTurn: v === "session" ? null : Number(v)})

    const refresh = () => {
        revalidateRecords(sessionId)
        void invalidateSessionInspector(queryClient, sessionId)
    }

    const exportPayload = () => {
        const records2 = records.data ?? []
        downloadText(
            JSON.stringify(records2, null, 2),
            `session-${sessionId.slice(0, 8)}${focusedTurn != null ? `-turn${focusedTurn}` : ""}.json`,
        )
    }

    return (
        <div className="ag-inspector-panel flex h-full min-h-0 min-w-0 flex-col overflow-hidden">
            {/* Header (build-spec §2): close · title · ScopeSwitch · identity · {} · refresh · export */}
            <div className="flex shrink-0 flex-col gap-1.5 border-0 border-b border-solid border-colorSplit px-2 py-2">
                <div className="flex items-center gap-2">
                    <Button
                        type="text"
                        size="small"
                        icon={<X size={14} />}
                        onClick={() => close()}
                        aria-label="Close inspector"
                    />
                    <span className="text-[13px] font-semibold">Inspector</span>
                    {/* One scope control for the whole panel: Session or a specific turn. */}
                    <Tooltip
                        title="Focus the whole inspector on one turn, or the whole session."
                        placement="bottom"
                        mouseEnterDelay={0.4}
                    >
                        <Select
                            size="small"
                            value={focusedTurn != null ? String(focusedTurn) : "session"}
                            onChange={onScopeChange}
                            options={scopeOptions}
                            popupMatchSelectWidth={false}
                            className="min-w-[96px]"
                        />
                    </Tooltip>
                    <div className="ml-auto flex items-center">
                        <Tooltip title={rawOpen ? "Hide raw JSON" : "Raw JSON"}>
                            <Button
                                type={rawOpen ? "primary" : "text"}
                                size="small"
                                icon={<BracketsCurly size={13} />}
                                onClick={() => setRawOpen((v) => !v)}
                                aria-label="Toggle raw JSON"
                            />
                        </Tooltip>
                        <Tooltip title="Refresh">
                            <Button
                                type="text"
                                size="small"
                                icon={<ArrowClockwise size={13} />}
                                onClick={refresh}
                                aria-label="Refresh"
                            />
                        </Tooltip>
                        <Tooltip title="Export">
                            <Button
                                type="text"
                                size="small"
                                icon={<DownloadSimple size={13} />}
                                onClick={exportPayload}
                                aria-label="Export"
                            />
                        </Tooltip>
                    </div>
                </div>
                {/* Identity line: the session is always the scope; a focused turn is the chip above. */}
                <div className="flex items-center gap-2 pl-1 text-[11px] text-colorTextTertiary">
                    <span className="min-w-0 truncate font-mono">{sessionId}</span>
                    <LivenessChips sessionId={sessionId} />
                </div>
            </div>

            <LensRail lens={lens} onChange={setLens} />
            {bodyReady ? (
                <LensBody
                    sessionId={sessionId}
                    focusedTurn={focusedTurn}
                    lens={lens}
                    rawOpen={rawOpen}
                    onDrillTurn={(turn) => setTarget({sessionId, focusedTurn: turn})}
                />
            ) : (
                <InspectorBodySkeleton />
            )}
        </div>
    )
}

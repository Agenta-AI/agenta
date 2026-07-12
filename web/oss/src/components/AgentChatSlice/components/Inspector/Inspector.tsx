/**
 * Inspector (build-spec §1–§7) — the single docked panel that replaces the SessionInspector
 * drawer and the Turn inspector. One shell, a Turn⇄Session scope switch, three lenses
 * (Timeline / Context / Runtime) + a Raw `{}` header toggle. Records-backed (cross-device);
 * scope only parameterises what the lenses query, never the chrome. Docks via RightPanelSplit.
 */
import {useMemo} from "react"

import {revalidateSessionRecordsAtom, sessionRecordsQueryFamily} from "@agenta/entities/session"
import {ArrowClockwise, BracketsCurly, DownloadSimple, X} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Segmented, Tooltip} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {downloadText} from "@/oss/lib/helpers/fileManipulations"

import {sessionLivenessAtomFamily} from "../../state/liveness"

import {LensBody} from "./LensBody"
import {LensRail} from "./LensRail"
import {
    closeInspectorAtom,
    inspectorLensAtom,
    inspectorRawOpenAtom,
    inspectorTargetAtom,
    type InspectorScope,
} from "./state"
import {buildTimeline} from "./timeline"

/** alive/running/attached chips on the session identity line (build-spec §3). */
const LivenessChips = ({sessionId}: {sessionId: string}) => {
    const {nest} = useAtomValue(sessionLivenessAtomFamily(sessionId))
    const chips: {label: string; color: string}[] = []
    if (nest.isAlive) chips.push({label: "alive", color: "#4fd1b5"})
    if (nest.isRunning) chips.push({label: "running", color: "#e0b050"})
    if (nest.isAttached) chips.push({label: "attached", color: "#7fb0ff"})
    if (chips.length === 0) chips.push({label: "dormant", color: "#9aa0a6"})
    return (
        <span className="ml-auto flex shrink-0 items-center gap-1">
            {chips.map((c) => (
                <span
                    key={c.label}
                    className="rounded px-1.5 py-px text-[10px] font-medium"
                    style={{background: "#212327", color: c.color}}
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
    const records = useAtomValue(sessionRecordsQueryFamily(sessionId))

    const active = target?.sessionId === sessionId ? target : null
    const scope: InspectorScope = active?.scope ?? "session"
    const targetTurn = active?.targetTurn ?? null

    const turnCount = useMemo(() => buildTimeline(records.data).turns.length, [records.data])

    if (!active) return null

    const setScope = (next: InspectorScope) => {
        if (next === "turn") {
            // Switching to Turn with nothing targeted focuses the latest turn.
            setTarget({sessionId, scope: "turn", targetTurn: targetTurn ?? (turnCount || 1)})
        } else {
            setTarget({sessionId, scope: "session"})
        }
    }

    const refresh = () => {
        revalidateRecords(sessionId)
        void queryClient.invalidateQueries({queryKey: ["session-inspector"]})
    }

    const exportPayload = () => {
        const records2 = records.data ?? []
        downloadText(
            JSON.stringify(records2, null, 2),
            `session-${sessionId.slice(0, 8)}-${scope}.json`,
        )
    }

    return (
        <div className="ag-inspector-panel flex h-full min-h-0 flex-col bg-[#17181b]">
            {/* Header (build-spec §2): close · title · ScopeSwitch · identity · {} · refresh · export */}
            <div className="flex shrink-0 flex-col gap-1.5 border-0 border-b border-solid border-[#2a2c30] px-2 py-2">
                <div className="flex items-center gap-2">
                    <Button
                        type="text"
                        size="small"
                        icon={<X size={14} />}
                        onClick={() => close()}
                        aria-label="Close inspector"
                    />
                    <span className="text-[13px] font-semibold">Inspector</span>
                    <Segmented
                        size="small"
                        value={scope}
                        onChange={(v) => setScope(v as InspectorScope)}
                        options={[
                            {label: "Turn", value: "turn"},
                            {label: "Session", value: "session"},
                        ]}
                    />
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
                {/* Identity line (build-spec §3). */}
                <div className="flex items-center gap-2 pl-1 text-[11px] text-colorTextTertiary">
                    {scope === "session" ? (
                        <>
                            <span className="min-w-0 truncate font-mono">{sessionId}</span>
                            <LivenessChips sessionId={sessionId} />
                        </>
                    ) : (
                        <>
                            <span className="font-medium text-colorText">
                                Turn {targetTurn ?? "—"}
                            </span>
                            <span className="text-colorTextQuaternary">of {turnCount}</span>
                            <button
                                type="button"
                                onClick={() => setScope("session")}
                                className="ml-auto cursor-pointer border-0 bg-transparent p-0 text-[var(--ag-colorInfo)] hover:underline"
                            >
                                View whole session
                            </button>
                        </>
                    )}
                </div>
            </div>

            <LensRail lens={lens} onChange={setLens} />
            <LensBody
                sessionId={sessionId}
                scope={scope}
                targetTurn={targetTurn}
                lens={lens}
                rawOpen={rawOpen}
                onDrillTurn={(turn) => setTarget({sessionId, scope: "turn", targetTurn: turn})}
            />
        </div>
    )
}

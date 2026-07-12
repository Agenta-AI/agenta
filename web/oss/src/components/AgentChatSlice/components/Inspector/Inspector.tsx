/**
 * Inspector (build-spec §1–§7) — the single docked panel that replaces the SessionInspector
 * drawer and the Turn inspector. One shell, a Turn⇄Session scope switch, three lenses
 * (Timeline / Context / Runtime) + a Raw `{}` header toggle. Records-backed (cross-device);
 * scope only parameterises what the lenses query, never the chrome. Docks via RightPanelSplit.
 */
import {useMemo} from "react"

import {revalidateSessionRecordsAtom, sessionRecordsQueryFamily} from "@agenta/entities/session"
import {CopyButton} from "@agenta/ui/components/presentational"
import {ArrowClockwise, BracketsCurly, DownloadSimple, X} from "@phosphor-icons/react"
import {useQueryClient} from "@tanstack/react-query"
import {Button, Segmented, Tooltip} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {downloadText} from "@/oss/lib/helpers/fileManipulations"

import {ContextLens} from "./lenses/ContextLens"
import {RuntimeLens} from "./lenses/RuntimeLens"
import {TimelineLens} from "./lenses/TimelineLens"
import {
    closeInspectorAtom,
    inspectorLensAtom,
    inspectorRawOpenAtom,
    inspectorTargetAtom,
    type InspectorLens,
    type InspectorScope,
} from "./state"
import {buildTimeline} from "./timeline"

const LENS_LABEL: Record<InspectorLens, string> = {
    timeline: "Timeline",
    context: "Context",
    runtime: "Runtime",
}

/** Raw JSON of the current lens/scope source (build-spec §4.4). Phase 1 serialises the records
 * (Timeline/Context source); Runtime raw is its own tabs' data, shown as the record stream too. */
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
                        <span className="truncate font-mono">{sessionId}</span>
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

            {/* Lens rail (build-spec §2): three tabs, always. */}
            <div className="flex shrink-0 items-center gap-1 border-0 border-b border-solid border-[#2a2c30] px-2 py-1.5">
                {(["timeline", "context", "runtime"] as InspectorLens[]).map((l) => (
                    <Button
                        key={l}
                        type="text"
                        size="small"
                        onClick={() => setLens(l)}
                        className={`!h-7 !rounded-md !px-2.5 !text-xs ${
                            lens === l
                                ? "!bg-[var(--ag-colorPrimaryBg)] !font-medium !text-[var(--ag-colorPrimary)]"
                                : "!text-[var(--ag-colorTextSecondary)] hover:!bg-[#212327]"
                        }`}
                    >
                        {LENS_LABEL[l]}
                    </Button>
                ))}
            </div>

            {/* Active lens, or the Raw overlay of it. */}
            {rawOpen ? (
                <RawView sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
            ) : lens === "timeline" ? (
                <TimelineLens sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
            ) : lens === "context" ? (
                <ContextLens sessionId={sessionId} scope={scope} targetTurn={targetTurn} />
            ) : (
                <RuntimeLens sessionId={sessionId} scope={scope} />
            )}
        </div>
    )
}

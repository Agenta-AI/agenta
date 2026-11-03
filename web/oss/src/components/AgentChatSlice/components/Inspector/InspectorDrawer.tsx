/**
 * InspectorDrawer — the floating, session-scoped variant of the Inspector for surfaces without a
 * docked chat (the comparison view's per-column inspect button). Same lenses as the docked
 * Inspector; session scope only (a compare column inspects a whole session, no turn concept),
 * local lens/raw state.
 */
import {revalidateSessionRecordsAtom, sessionRecordsQueryFamily} from "@agenta/entities/session"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {ArrowClockwise, BracketsCurly, DownloadSimple} from "@phosphor-icons/react"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {downloadText} from "@/oss/lib/helpers/fileManipulations"

import {LensBody} from "./LensBody"
import {LensRail} from "./LensRail"
import {inspectorLensAtom, inspectorRawOpenAtom} from "./state"

export function InspectorDrawer({
    sessionId,
    open,
    onClose,
}: {
    sessionId: string
    open: boolean
    onClose: () => void
}) {
    const [lens, setLens] = useAtom(inspectorLensAtom)
    const [rawOpen, setRawOpen] = useAtom(inspectorRawOpenAtom)
    const revalidate = useSetAtom(revalidateSessionRecordsAtom)
    const records = useAtomValue(sessionRecordsQueryFamily(open ? sessionId : ""))

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={560}
            destroyOnClose
            styles={{body: {padding: 0, display: "flex", minHeight: 0}, header: {display: "none"}}}
        >
            <div className="flex h-full min-h-0 flex-col bg-[var(--ag-surface-raised)]">
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-colorSplit px-2 py-2">
                    <span className="text-[13px] font-semibold">Inspector</span>
                    <span className="min-w-0 truncate font-mono text-xs text-colorTextTertiary">
                        {sessionId}
                    </span>
                    <div className="ml-auto flex items-center">
                        <SimpleTooltip title={rawOpen ? "Hide raw JSON" : "Raw JSON"}>
                            <Button
                                variant={rawOpen ? "default" : "ghost"}
                                size="icon-sm"
                                onClick={() => setRawOpen(!rawOpen)}
                                aria-label="Toggle raw JSON"
                            >
                                <BracketsCurly size={13} />
                            </Button>
                        </SimpleTooltip>
                        <SimpleTooltip title="Refresh">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() => revalidate(sessionId)}
                                aria-label="Refresh"
                            >
                                <ArrowClockwise size={13} />
                            </Button>
                        </SimpleTooltip>
                        <SimpleTooltip title="Export">
                            <Button
                                variant="ghost"
                                size="icon-sm"
                                onClick={() =>
                                    downloadText(
                                        JSON.stringify(records.data ?? [], null, 2),
                                        `session-${sessionId.slice(0, 8)}-session.json`,
                                    )
                                }
                                aria-label="Export"
                            >
                                <DownloadSimple size={13} />
                            </Button>
                        </SimpleTooltip>
                    </div>
                </div>
                <LensRail lens={lens} onChange={setLens} />
                <LensBody sessionId={sessionId} lens={lens} rawOpen={rawOpen} />
            </div>
        </EnhancedDrawer>
    )
}

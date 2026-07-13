/**
 * InspectorDrawer — the floating, session-scoped variant of the Inspector for surfaces without a
 * docked chat (the comparison view's per-column inspect button). Same lenses as the docked
 * Inspector; session scope only (a compare column inspects a whole session, no turn concept),
 * local lens/raw state.
 */
import {revalidateSessionRecordsAtom, sessionRecordsQueryFamily} from "@agenta/entities/session"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {ArrowClockwise, BracketsCurly, DownloadSimple} from "@phosphor-icons/react"
import {Button, Tooltip} from "antd"
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
            closeOnLayoutClick={false}
            styles={{body: {padding: 0, display: "flex", minHeight: 0}, header: {display: "none"}}}
        >
            <div className="flex h-full min-h-0 flex-col bg-[#17181b]">
                <div className="flex shrink-0 items-center gap-2 border-0 border-b border-solid border-[#2a2c30] px-2 py-2">
                    <span className="text-[13px] font-semibold">Inspector</span>
                    <span className="min-w-0 truncate font-mono text-[11px] text-colorTextTertiary">
                        {sessionId}
                    </span>
                    <div className="ml-auto flex items-center">
                        <Tooltip title={rawOpen ? "Hide raw JSON" : "Raw JSON"}>
                            <Button
                                type={rawOpen ? "primary" : "text"}
                                size="small"
                                icon={<BracketsCurly size={13} />}
                                onClick={() => setRawOpen(!rawOpen)}
                                aria-label="Toggle raw JSON"
                            />
                        </Tooltip>
                        <Tooltip title="Refresh">
                            <Button
                                type="text"
                                size="small"
                                icon={<ArrowClockwise size={13} />}
                                onClick={() => revalidate(sessionId)}
                                aria-label="Refresh"
                            />
                        </Tooltip>
                        <Tooltip title="Export">
                            <Button
                                type="text"
                                size="small"
                                icon={<DownloadSimple size={13} />}
                                onClick={() =>
                                    downloadText(
                                        JSON.stringify(records.data ?? [], null, 2),
                                        `session-${sessionId.slice(0, 8)}-session.json`,
                                    )
                                }
                                aria-label="Export"
                            />
                        </Tooltip>
                    </div>
                </div>
                <LensRail lens={lens} onChange={setLens} />
                <LensBody sessionId={sessionId} lens={lens} rawOpen={rawOpen} />
            </div>
        </EnhancedDrawer>
    )
}

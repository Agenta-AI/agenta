/**
 * RuntimeLens (build-spec §4.3) — live sandbox facts for the session, laid out with the SAME
 * ConfigAccordionSection pattern as the config panel (clean icon-titled collapsible sections, not
 * bespoke black cards): Lifecycle (streams + Attach/Detach/Kill), State, and Files. Lifecycle/State
 * reuse the endpoint-backed SessionInspector tabs; Files reuses the DRIVE stack (same listing +
 * Quick Look as everywhere else). Runtime is always session-level — a focused turn doesn't change
 * live facts.
 */
import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {Broadcast, CaretRight, Database, FolderSimple} from "@phosphor-icons/react"
import {useSetAtom} from "jotai"

import {DriveFileRow} from "@/oss/components/Drives/DriveFileRow"
import {humanSize} from "@/oss/components/Drives/driveTree"
import {filesDrawerOpenAtomFamily} from "@/oss/components/Drives/FilesDrawer"
import {driveQuickLookAtomFamily} from "@/oss/components/Drives/quickLook"
import {useSessionDrive} from "@/oss/components/Drives/useSessionDrive"
import StatesTab from "@/oss/components/SessionInspector/tabs/StatesTab"
import StreamsTab from "@/oss/components/SessionInspector/tabs/StreamsTab"

/** The session's files, via the shared drive stack — a click opens the same Quick Look drawer as
 * the chat/config surfaces; "View all files" opens the full Files drawer. */
const DriveFilesCard = ({sessionId}: {sessionId: string}) => {
    const drive = useSessionDrive(sessionId)
    const openQuickLook = useSetAtom(driveQuickLookAtomFamily(sessionId))
    const openFiles = useSetAtom(filesDrawerOpenAtomFamily(sessionId))

    if (drive.errored)
        return (
            <span className="text-xs text-colorTextTertiary">
                Couldn&rsquo;t load this session&rsquo;s files.
            </span>
        )
    if (drive.isLoading) return <span className="text-xs text-colorTextTertiary">Loading…</span>
    if (drive.fileCount === 0)
        return (
            <span className="text-xs text-colorTextTertiary">
                No files yet — this conversation gets its drive on first run.
            </span>
        )
    return (
        <div className="flex flex-col">
            {drive.recents.slice(0, 6).map((f) => (
                <DriveFileRow
                    key={f.path}
                    path={f.path}
                    label={f.path}
                    trailing={humanSize(f.size)}
                    onOpen={() => openQuickLook({path: f.path})}
                />
            ))}
            {drive.fileCount > 6 ? (
                <button
                    type="button"
                    onClick={() => openFiles(true)}
                    className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                >
                    View all files
                    <CaretRight size={11} />
                </button>
            ) : null}
        </div>
    )
}

export function RuntimeLens({sessionId}: {sessionId: string}) {
    return (
        <div className="min-h-0 min-w-0 flex-1 overflow-y-auto px-3">
            <ConfigAccordionSection
                icon={<Broadcast size={16} className="text-colorTextSecondary" />}
                title="Lifecycle"
                size="compact"
            >
                <StreamsTab sessionId={sessionId} />
            </ConfigAccordionSection>
            <ConfigAccordionSection
                icon={<Database size={16} className="text-colorTextSecondary" />}
                title="State"
                size="compact"
            >
                <StatesTab sessionId={sessionId} />
            </ConfigAccordionSection>
            <ConfigAccordionSection
                icon={<FolderSimple size={16} className="text-colorTextSecondary" />}
                title="Files"
                size="compact"
                noDivider
            >
                <DriveFilesCard sessionId={sessionId} />
            </ConfigAccordionSection>
        </div>
    )
}

/**
 * StorageSection — the config panel's Storage group body (build-spec direction 1a, view A).
 *
 * Two rows in the config-section style: App drive (phase-1 gated, "Coming soon" pill) and
 * Session drive (summary = last activity + count; expanded body = description + top-3 recent
 * files + "View all files"). Recent rows carry the full relative path (mono) — this is what
 * abstracts the raw cwd/session UUIDs away. Rows open the DriveDrawer, preselected on the
 * clicked file. Lives in the app layer because it reads the chat slice's session state.
 */
import {useState} from "react"

import {ConfigAccordionSection} from "@agenta/ui/components/presentational"
import {CaretRight, ChatCircle, HardDrives} from "@phosphor-icons/react"
import {Typography} from "antd"
import {useAtomValue} from "jotai"

import {useChatScopeKey} from "@/oss/components/AgentChatSlice/state/scope"
import {isSessionFresh} from "@/oss/components/AgentChatSlice/state/sessionEphemera"
import {
    activeSessionIdAtomFamily,
    sessionsListAtomFamily,
} from "@/oss/components/AgentChatSlice/state/sessions"

import {DriveDrawer} from "./DriveDrawer"
import {humanSize, relativeTime} from "./driveTree"
import {useSessionDrive, type DriveRecentFile} from "./useSessionDrive"

const {Text} = Typography

const RecentFileRow = ({file, onOpen}: {file: DriveRecentFile; onOpen: () => void}) => (
    <button
        type="button"
        onClick={onOpen}
        className="flex w-full cursor-pointer items-center gap-2 rounded border-0 bg-transparent px-1.5 py-1 text-left transition-colors hover:bg-colorFillTertiary"
    >
        <span className="min-w-0 truncate font-mono text-xs">{file.path}</span>
        <span className="ml-auto shrink-0 text-[11px] text-colorTextTertiary">
            {humanSize(file.size)}
            {file.touchedAt ? <> · {relativeTime(file.touchedAt)}</> : null}
        </span>
        <CaretRight size={11} className="shrink-0 text-colorTextQuaternary" />
    </button>
)

const SessionDriveBody = ({
    sessionId,
    onOpenDrawer,
}: {
    sessionId: string
    onOpenDrawer: (initialPath: string | null) => void
}) => {
    const drive = useSessionDrive(sessionId)

    if (drive.errored) {
        return (
            <Text type="secondary" className="!text-xs">
                Couldn&rsquo;t load this conversation&rsquo;s files — the file store may not be
                configured on this deployment.
            </Text>
        )
    }
    return (
        <div className="flex flex-col gap-2">
            <Text type="secondary" className="!text-xs">
                Files of the active conversation. New conversations get their own drive on the first
                run.
            </Text>
            {drive.fileCount > 0 ? (
                <div className="flex flex-col">
                    {drive.recents.slice(0, 3).map((file) => (
                        <RecentFileRow
                            key={file.path}
                            file={file}
                            onOpen={() => onOpenDrawer(file.path)}
                        />
                    ))}
                    {drive.fileCount > 3 ? (
                        <button
                            type="button"
                            onClick={() => onOpenDrawer(null)}
                            className="mt-1 flex w-fit cursor-pointer items-center gap-1 rounded border-0 bg-transparent px-1.5 py-0.5 text-xs text-[var(--ag-colorInfo)] hover:underline"
                        >
                            View all files
                            <CaretRight size={11} />
                        </button>
                    ) : null}
                </div>
            ) : null}
        </div>
    )
}

export default function StorageSection() {
    const scope = useChatScopeKey()
    const sessions = useAtomValue(sessionsListAtomFamily(scope))
    const rawActiveId = useAtomValue(activeSessionIdAtomFamily(scope))
    // Same fallback the chat uses: a stale active id (closed tab) resolves to the first open tab.
    const resolvedId = sessions.some((s) => s.id === rawActiveId)
        ? rawActiveId
        : (sessions[0]?.id ?? "")
    // A brand-new never-run tab has no server data by construction — hold the queries off (empty
    // id disables them) until its first run instead of asking the backend for guaranteed-empties.
    const sessionId = resolvedId && !isSessionFresh(resolvedId) ? resolvedId : ""

    const [drawer, setDrawer] = useState<{open: boolean; initialPath: string | null}>({
        open: false,
        initialPath: null,
    })

    return (
        <div className="flex flex-col">
            {/* App drive — phase-1 gated: same row shape, "Coming soon" pill, no drawer. */}
            <ConfigAccordionSection
                icon={<HardDrives size={16} style={{color: "#7fb0ff"}} />}
                title="App drive"
                summary="Coming soon"
                defaultOpen={false}
                animateInitialOpen
            >
                <Text type="secondary" className="!text-xs">
                    One durable folder this agent keeps across every conversation — the skills,
                    notes, and artifacts it accumulates. Agent-level storage is in design; its files
                    will be browsable here once it lands.
                </Text>
            </ConfigAccordionSection>

            <SessionDriveRow
                sessionId={sessionId}
                onOpenDrawer={(p) => setDrawer({open: true, initialPath: p})}
            />

            {sessionId ? (
                <DriveDrawer
                    open={drawer.open}
                    onClose={() => setDrawer((prev) => ({...prev, open: false}))}
                    sessionId={sessionId}
                    scope="session"
                    initialPath={drawer.initialPath}
                />
            ) : null}
        </div>
    )
}

/** The Session drive row. Its collapsed summary ("Updated 2m ago · 6 files") NEEDS the listing,
 * so the drive queries are live whenever a non-fresh session is active — low-priority, 30s
 * staleTime, and shared (deduped) with the drawer and every chat drive surface. */
const SessionDriveRow = ({
    sessionId,
    onOpenDrawer,
}: {
    sessionId: string
    onOpenDrawer: (initialPath: string | null) => void
}) => {
    const [open, setOpen] = useState(false)
    // The summary requires the listing, so the row's queries are live whenever an active
    // session exists — they're low-priority + shared with every other drive surface.
    const drive = useSessionDrive(sessionId)

    return (
        <ConfigAccordionSection
            icon={<ChatCircle size={16} style={{color: "#4fd1b5"}} />}
            title="Session drive"
            summary={sessionId ? drive.summary : "Per conversation"}
            open={open}
            onOpenChange={setOpen}
            noDivider
        >
            {open ? (
                sessionId ? (
                    <SessionDriveBody sessionId={sessionId} onOpenDrawer={onOpenDrawer} />
                ) : (
                    <Typography.Text type="secondary" className="!text-xs">
                        No conversation open — start a chat and its working files show up here.
                    </Typography.Text>
                )
            ) : null}
        </ConfigAccordionSection>
    )
}

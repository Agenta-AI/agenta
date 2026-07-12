/**
 * DriveDrawer — the two-pane drive inspector (build-spec direction 1a, view B).
 *
 * Right drawer on the existing shell (`EnhancedDrawer`), but an INSPECTOR, not a form: no
 * Form/JSON toggle, no Create/Cancel. Left pane = search + file tree (folders first, alpha);
 * right pane = breadcrumb + meta + per-file Download + content viewer (markdown for
 * `.md/.markdown`, raw mono otherwise). Phase 1 is read-only; `scope="app"` is the same drawer
 * for the app drive (phase 2 — everything but header accents/subtitle/footer is shared).
 */
import {useEffect, useMemo, useState} from "react"

import {mountFileContentQueryFamily, type Mount} from "@agenta/entities/session"
import {EnhancedDrawer} from "@agenta/ui/drawer"
import {
    BracketsCurly,
    CaretDown,
    CaretRight,
    ChatCircle,
    DownloadSimple,
    File,
    FileText,
    FolderSimple,
    HardDrives,
    House,
    MagnifyingGlass,
    Tray,
} from "@phosphor-icons/react"
import {Alert, Button, Input, Skeleton, Tag, Tooltip, Typography} from "antd"
import {useAtomValue} from "jotai"

import Markdown from "@/oss/components/AgentChatSlice/assets/markdown"
import useURL from "@/oss/hooks/useURL"

import {downloadTextFile} from "./download"
import {
    ancestorPaths,
    buildDriveTree,
    filterDriveTree,
    humanSize,
    isMarkdownPath,
    relativeTime,
    type DriveTreeNode,
} from "./driveTree"
import {useSessionDrive} from "./useSessionDrive"

const {Text} = Typography

// Scope accents from the spec: session = teal, app = blue (icon tint only; everything else
// rides the semantic tokens so light mode stays coherent).
const SCOPE_META = {
    session: {icon: ChatCircle, accent: "#4fd1b5", tag: "per conversation"},
    app: {icon: HardDrives, accent: "#7fb0ff", tag: "shared across conversations"},
} as const

export type DriveScope = keyof typeof SCOPE_META

const fileIcon = (path: string, size = 14) => {
    if (isMarkdownPath(path)) return <FileText size={size} className="text-[#4fd1b5]" />
    if (/\.json$/i.test(path)) return <BracketsCurly size={size} className="text-colorWarning" />
    return <File size={size} className="text-colorTextTertiary" />
}

const fileTypeLabel = (path: string): string => {
    if (isMarkdownPath(path)) return "Markdown"
    const ext = path.split(".").pop()
    return ext && ext !== path ? ext.toUpperCase() : "File"
}

/** One tree row (folder or file), indented by depth; selection = fill + primary ring. */
const TreeRow = ({
    node,
    depth,
    expanded,
    selectedPath,
    onToggle,
    onSelect,
}: {
    node: DriveTreeNode
    depth: number
    expanded: Set<string>
    selectedPath: string | null
    onToggle: (path: string) => void
    onSelect: (path: string) => void
}) => {
    const isOpen = expanded.has(node.path)
    const selected = !node.isFolder && node.path === selectedPath
    return (
        <>
            <button
                type="button"
                onClick={() => (node.isFolder ? onToggle(node.path) : onSelect(node.path))}
                className={`flex w-full cursor-pointer items-center gap-1.5 rounded border-0 bg-transparent px-1.5 py-1 text-left text-xs transition-colors ${
                    selected
                        ? "bg-colorFillSecondary shadow-[inset_0_0_0_1px_var(--ag-colorPrimary)]"
                        : "hover:bg-colorFillTertiary"
                }`}
                style={{paddingLeft: 6 + depth * 14}}
            >
                {node.isFolder ? (
                    <>
                        {isOpen ? (
                            <CaretDown size={10} className="shrink-0 text-colorTextQuaternary" />
                        ) : (
                            <CaretRight size={10} className="shrink-0 text-colorTextQuaternary" />
                        )}
                        <FolderSimple size={14} className="shrink-0 text-colorWarning" />
                    </>
                ) : (
                    <span className="shrink-0 pl-[14px]">{fileIcon(node.path)}</span>
                )}
                <span className="min-w-0 truncate font-mono">{node.name}</span>
                {!node.isFolder && node.size != null ? (
                    <span className="ml-auto shrink-0 text-[11px] text-colorTextQuaternary">
                        {humanSize(node.size)}
                    </span>
                ) : null}
            </button>
            {node.isFolder && isOpen
                ? node.children.map((child) => (
                      <TreeRow
                          key={child.path}
                          node={child}
                          depth={depth + 1}
                          expanded={expanded}
                          selectedPath={selectedPath}
                          onToggle={onToggle}
                          onSelect={onSelect}
                      />
                  ))
                : null}
        </>
    )
}

/** Right pane: breadcrumb + name/meta + Download + content viewer. Exported for reuse by the
 * chat Quick Look (same renderer, different shell). */
export const DriveFilePreview = ({
    mount,
    path,
    rootLabel,
    touchedAt,
    size,
    onNavigateRoot,
}: {
    mount: Mount | null
    path: string
    rootLabel: string
    touchedAt?: number
    size?: number
    onNavigateRoot?: () => void
}) => {
    const contentQuery = useAtomValue(mountFileContentQueryFamily({mountId: mount?.id ?? "", path}))
    const name = path.split("/").pop() ?? path
    const folders = path.split("/").slice(0, -1)
    const content = contentQuery.data

    return (
        <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-4">
            <div className="flex items-center gap-1 text-[11px] text-colorTextTertiary">
                <button
                    type="button"
                    onClick={onNavigateRoot}
                    className="flex cursor-pointer items-center gap-1 rounded border-0 bg-transparent p-0 text-colorTextTertiary hover:text-colorText"
                >
                    <House size={12} />
                    <span className="font-mono">{rootLabel}</span>
                </button>
                {[...folders, name].map((segment, i) => (
                    <span key={i} className="flex items-center gap-1 font-mono">
                        <span className="text-colorTextQuaternary">/</span>
                        {segment}
                    </span>
                ))}
            </div>

            <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                    <div className="truncate font-mono text-[13px] font-semibold">{name}</div>
                    <div className="text-[11px] text-colorTextTertiary">
                        {fileTypeLabel(path)}
                        {size != null ? <> · {humanSize(size)}</> : null}
                        {touchedAt ? <> · modified {relativeTime(touchedAt)}</> : null}
                    </div>
                </div>
                <Button
                    size="small"
                    icon={<DownloadSimple size={13} />}
                    disabled={typeof content !== "string"}
                    onClick={() => typeof content === "string" && downloadTextFile(name, content)}
                >
                    Download
                </Button>
            </div>

            <div className="min-h-0 flex-1 overflow-y-auto rounded border border-solid border-colorBorderSecondary bg-colorFillQuaternary p-3">
                {contentQuery.isPending ? (
                    <Skeleton active paragraph={{rows: 6}} />
                ) : typeof content !== "string" ? (
                    <Text type="secondary" className="!text-xs">
                        Couldn&rsquo;t load this file&rsquo;s content.
                    </Text>
                ) : isMarkdownPath(path) ? (
                    <Markdown content={content} className="!text-xs" />
                ) : (
                    <pre className="m-0 whitespace-pre-wrap break-words font-mono text-xs text-colorTextSecondary">
                        {content}
                    </pre>
                )}
            </div>
        </div>
    )
}

export interface DriveDrawerProps {
    open: boolean
    onClose: () => void
    sessionId: string
    scope?: DriveScope
    /** Preselect this file on open (a recents row click); omit → most-recently-touched. */
    initialPath?: string | null
}

export function DriveDrawer({
    open,
    onClose,
    sessionId,
    scope = "session",
    initialPath,
}: DriveDrawerProps) {
    const {projectURL} = useURL()
    const drive = useSessionDrive(sessionId)
    const meta = SCOPE_META[scope]
    const ScopeIcon = meta.icon
    const rootLabel = drive.mount?.slug ?? "cwd"

    const [search, setSearch] = useState("")
    const [selectedPath, setSelectedPath] = useState<string | null>(null)
    const [expanded, setExpanded] = useState<Set<string>>(new Set())

    // On open: reset search, select the requested file, else the most-recently-touched one,
    // and expand the selection's ancestors.
    useEffect(() => {
        if (!open) return
        setSearch("")
        const target = initialPath ?? drive.recents[0]?.path ?? null
        setSelectedPath(target)
        setExpanded(new Set(target ? ancestorPaths(target) : []))
        // Intentionally NOT keyed on drive.recents: re-running on listing refreshes would yank
        // the user's selection mid-browse. Open/initialPath are the only (re)entry points.
    }, [open, initialPath])

    const tree = useMemo(() => buildDriveTree(drive.files), [drive.files])
    const shownTree = useMemo(() => filterDriveTree(tree, search), [tree, search])
    // While searching, show every surviving branch expanded so matches are visible.
    const shownExpanded = useMemo(
        () => (search.trim() ? new Set(collectFolderPaths(shownTree)) : expanded),
        [search, shownTree, expanded],
    )

    const selected = drive.recents.find((f) => f.path === selectedPath) ?? null

    return (
        <EnhancedDrawer
            rootClassName="ag-drawer-elevated"
            open={open}
            onClose={onClose}
            placement="right"
            width={720}
            destroyOnClose
            closeOnLayoutClick={false}
            title={
                <div className="flex min-w-0 items-center gap-2">
                    <ScopeIcon size={16} style={{color: meta.accent}} className="shrink-0" />
                    <div className="min-w-0">
                        <div className="flex min-w-0 items-center gap-2">
                            <span className="truncate text-sm font-medium">
                                {scope === "session" ? "Session drive" : "App drive"}
                            </span>
                            <Tag className="m-0 shrink-0 text-[11px] font-normal">{meta.tag}</Tag>
                        </div>
                        {/* The raw session UUID lives HERE only — never as a user-facing label. */}
                        <div className="truncate text-xs font-normal text-colorTextTertiary">
                            {drive.fileCount} file{drive.fileCount === 1 ? "" : "s"} ·{" "}
                            {humanSize(drive.totalSize) || "0 B"} ·{" "}
                            <span className="font-mono">{sessionId}</span>
                        </div>
                    </div>
                </div>
            }
            extra={
                <Tooltip title="Download the whole drive as a zip — coming soon">
                    <Button size="small" icon={<DownloadSimple size={13} />} disabled>
                        Download all
                    </Button>
                </Tooltip>
            }
            footer={
                <div className="flex items-center justify-between gap-2 text-xs">
                    <span className="text-colorTextTertiary">
                        Read-only · editing &amp; uploads coming soon
                    </span>
                    <a
                        href={`${projectURL}/observability`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[var(--ag-colorInfo)]"
                    >
                        Open in Observability ↗
                    </a>
                </div>
            }
            styles={{body: {padding: 0, display: "flex", minHeight: 0}}}
        >
            {drive.errored ? (
                <div className="p-4">
                    <Alert
                        type="warning"
                        showIcon
                        message="Couldn't load this drive"
                        description={
                            <span className="text-xs">
                                The file store may not be configured on this deployment.
                            </span>
                        }
                    />
                </div>
            ) : drive.isLoading ? (
                <div className="flex min-h-0 w-full flex-1">
                    <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                        <Skeleton.Input active size="small" block />
                        <div className="mt-3">
                            <Skeleton active paragraph={{rows: 4}} title={false} />
                        </div>
                    </div>
                    <div className="flex-1 p-4">
                        <Skeleton active paragraph={{rows: 8}} />
                    </div>
                </div>
            ) : drive.fileCount === 0 ? (
                <div className="flex min-h-0 w-full flex-1">
                    <div className="w-[240px] shrink-0 border-0 border-r border-solid border-colorBorderSecondary p-3">
                        <Input size="small" disabled placeholder="Search" />
                    </div>
                    <div className="flex flex-1 flex-col items-center justify-center gap-1 p-8 text-center">
                        <Tray size={28} className="text-colorTextQuaternary" />
                        <div className="text-xs font-medium">This drive is empty</div>
                        <div className="text-[11px] text-colorTextTertiary">
                            {scope === "session"
                                ? "Created on the conversation's first run."
                                : "Files the agent keeps across conversations land here."}
                        </div>
                    </div>
                </div>
            ) : (
                <div className="flex min-h-0 w-full flex-1">
                    <div className="flex w-[240px] shrink-0 flex-col gap-2 overflow-y-auto border-0 border-r border-solid border-colorBorderSecondary p-3">
                        <Input
                            size="small"
                            allowClear
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search files"
                            prefix={
                                <MagnifyingGlass size={12} className="text-colorTextQuaternary" />
                            }
                        />
                        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
                            {shownTree.length === 0 ? (
                                <Text type="secondary" className="px-1 !text-[11px]">
                                    No files match.
                                </Text>
                            ) : (
                                shownTree.map((node) => (
                                    <TreeRow
                                        key={node.path}
                                        node={node}
                                        depth={0}
                                        expanded={shownExpanded}
                                        selectedPath={selectedPath}
                                        onToggle={(path) =>
                                            setExpanded((prev) => {
                                                const next = new Set(prev)
                                                if (next.has(path)) next.delete(path)
                                                else next.add(path)
                                                return next
                                            })
                                        }
                                        onSelect={setSelectedPath}
                                    />
                                ))
                            )}
                        </div>
                    </div>
                    {selectedPath ? (
                        <DriveFilePreview
                            mount={drive.mount}
                            path={selectedPath}
                            rootLabel={rootLabel}
                            touchedAt={selected?.touchedAt}
                            size={selected?.size ?? undefined}
                            onNavigateRoot={() => setSelectedPath(drive.recents[0]?.path ?? null)}
                        />
                    ) : (
                        <div className="flex flex-1 items-center justify-center text-xs text-colorTextTertiary">
                            Select a file to preview it.
                        </div>
                    )}
                </div>
            )}
        </EnhancedDrawer>
    )
}

const collectFolderPaths = (nodes: DriveTreeNode[]): string[] =>
    nodes.flatMap((n) => (n.isFolder ? [n.path, ...collectFolderPaths(n.children)] : []))

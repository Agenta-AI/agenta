import {useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {File as FileIcon, FolderSimple} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {Alert, Button, Collapse, Empty, List, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {
    fetchAgentMount,
    fetchMountFileBlob,
    fetchMountFiles,
    fetchMountFileText,
    fetchMounts,
    type MountFileEntry,
} from "../api"
import {deriveRows, formatSize} from "../assets/mountBrowser"

const {Text} = Typography

const TEXT_EXTENSIONS = new Set([
    "md",
    "txt",
    "json",
    "yaml",
    "yml",
    "py",
    "ts",
    "tsx",
    "js",
    "jsx",
    "log",
    "csv",
    "toml",
    "sh",
    "html",
    "css",
])
const IMAGE_EXTENSIONS = new Set(["png", "jpg", "jpeg", "gif", "svg", "webp"])
const MAX_PREVIEW_BYTES = 2 * 1024 * 1024

const basename = (path: string): string => path.split("/").pop() || path

const extOf = (path: string): string => {
    const base = basename(path)
    const idx = base.lastIndexOf(".")
    return idx <= 0 ? "" : base.slice(idx + 1).toLowerCase()
}

const previewKind = (path: string): "text" | "image" | "other" => {
    const ext = extOf(path)
    if (!ext || TEXT_EXTENSIONS.has(ext)) return "text"
    if (IMAGE_EXTENSIONS.has(ext)) return "image"
    return "other"
}

const triggerDownload = (blob: Blob, filename: string): void => {
    const url = URL.createObjectURL(blob)
    const link = document.createElement("a")
    link.href = url
    link.download = filename
    document.body.appendChild(link)
    link.click()
    document.body.removeChild(link)
    // Defer revoke: Firefox can cancel the save if the URL is revoked synchronously.
    setTimeout(() => URL.revokeObjectURL(url), 0)
}

const DownloadButton = ({
    mountId,
    projectId,
    entry,
}: {
    mountId: string
    projectId?: string | null
    entry: MountFileEntry
}) => {
    const [downloading, setDownloading] = useState(false)

    const onDownload = async () => {
        setDownloading(true)
        try {
            const blob = await fetchMountFileBlob(mountId, projectId, entry.path)
            triggerDownload(blob, basename(entry.path))
        } catch {
            message.error("Download failed")
        } finally {
            setDownloading(false)
        }
    }

    return (
        <Button size="small" loading={downloading} onClick={onDownload}>
            Download
        </Button>
    )
}

const FilePreview = ({
    mountId,
    projectId,
    entry,
    onClose,
}: {
    mountId: string
    projectId?: string | null
    entry: MountFileEntry
    onClose: () => void
}) => {
    const kind = previewKind(entry.path)
    const tooLarge = entry.size > MAX_PREVIEW_BYTES

    const textQuery = useQuery({
        queryKey: ["session-inspector", "mount-file-text", projectId, mountId, entry.path],
        queryFn: () => fetchMountFileText(mountId, projectId, entry.path),
        enabled: kind === "text" && !tooLarge,
        refetchOnWindowFocus: false,
    })

    const blobQuery = useQuery({
        queryKey: ["session-inspector", "mount-file-blob", projectId, mountId, entry.path],
        queryFn: () => fetchMountFileBlob(mountId, projectId, entry.path),
        enabled: kind === "image" && !tooLarge,
        refetchOnWindowFocus: false,
    })

    const [objectUrl, setObjectUrl] = useState<string | null>(null)
    // Create the object URL as an effect (not in useMemo) so StrictMode's double-render
    // can't orphan one; revoke the previous URL on every re-run and on unmount.
    useEffect(() => {
        if (!blobQuery.data) {
            setObjectUrl(null)
            return
        }
        const url = URL.createObjectURL(blobQuery.data)
        setObjectUrl(url)
        return () => URL.revokeObjectURL(url)
    }, [blobQuery.data])

    return (
        <div className="mt-2 rounded border border-solid border-colorBorderSecondary p-2">
            <div className="mb-2 flex items-center justify-between gap-2">
                <span className="truncate font-mono text-xs">{basename(entry.path)}</span>
                <Button type="text" size="small" onClick={onClose}>
                    Close
                </Button>
            </div>
            {tooLarge ? (
                <div className="flex flex-col items-start gap-2">
                    <Text type="secondary" className="text-xs">
                        File too large to preview ({formatSize(entry.size)}).
                    </Text>
                    <DownloadButton mountId={mountId} projectId={projectId} entry={entry} />
                </div>
            ) : kind === "text" ? (
                textQuery.isLoading ? (
                    <Skeleton active />
                ) : textQuery.error ? (
                    <Alert type="error" message="Failed to load file" showIcon />
                ) : (
                    <pre className="m-0 max-h-[40vh] overflow-auto whitespace-pre-wrap break-words text-xs">
                        {textQuery.data?.content}
                    </pre>
                )
            ) : kind === "image" ? (
                blobQuery.isLoading ? (
                    <Skeleton active />
                ) : blobQuery.error ? (
                    <Alert type="error" message="Failed to load image" showIcon />
                ) : objectUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element -- object URL, not a static asset
                    <img src={objectUrl} className="max-w-full" alt={basename(entry.path)} />
                ) : null
            ) : (
                <div className="flex flex-col items-start gap-2">
                    <Text type="secondary" className="text-xs">
                        No preview available.
                    </Text>
                    <DownloadButton mountId={mountId} projectId={projectId} entry={entry} />
                </div>
            )}
        </div>
    )
}

const MountFilesPanel = ({mountId, projectId}: {mountId: string; projectId?: string | null}) => {
    const [path, setPath] = useState("")
    const [previewEntry, setPreviewEntry] = useState<MountFileEntry | null>(null)

    const queryKey = ["session-inspector", "mount-files", projectId, mountId, path]
    const {data, isLoading, error} = useQuery({
        queryKey,
        queryFn: () => fetchMountFiles(mountId, projectId, path || undefined),
        refetchOnWindowFocus: false,
    })

    const segments = path ? path.split("/") : []
    const navigateTo = (depth: number) => {
        setPreviewEntry(null)
        setPath(segments.slice(0, depth).join("/"))
    }

    const files = data?.files ?? []
    const rows = useMemo(() => deriveRows(files, path), [files, path])

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load files" showIcon />

    return (
        <div className="flex flex-col gap-2">
            <div className="flex flex-wrap items-center gap-1 text-xs text-colorTextSecondary">
                <button
                    type="button"
                    className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-colorPrimary focus-visible:outline"
                    onClick={() => navigateTo(0)}
                >
                    root
                </button>
                {segments.map((segment, i) => (
                    <span key={i} className="flex items-center gap-1">
                        <span>/</span>
                        <button
                            type="button"
                            className="cursor-pointer border-0 bg-transparent p-0 text-inherit hover:text-colorPrimary focus-visible:outline"
                            onClick={() => navigateTo(i + 1)}
                        >
                            {segment}
                        </button>
                    </span>
                ))}
            </div>
            {rows.length === 0 ? (
                <Empty description="Empty folder" image={Empty.PRESENTED_IMAGE_SIMPLE} />
            ) : (
                <List
                    size="small"
                    dataSource={rows}
                    renderItem={(row) => (
                        <List.Item
                            className="cursor-pointer"
                            role="button"
                            tabIndex={0}
                            onClick={() => {
                                if (row.kind === "folder") {
                                    setPreviewEntry(null)
                                    setPath(row.path)
                                } else {
                                    setPreviewEntry(row.entry)
                                }
                            }}
                            onKeyDown={(event) => {
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault()
                                    event.currentTarget.click()
                                }
                            }}
                        >
                            <List.Item.Meta
                                avatar={
                                    row.kind === "folder" ? (
                                        <FolderSimple size={16} />
                                    ) : (
                                        <FileIcon size={16} />
                                    )
                                }
                                title={<span className="font-mono text-xs">{row.name}</span>}
                                description={
                                    row.kind === "file" && (
                                        <Text type="secondary" className="text-xs">
                                            {formatSize(row.entry.size)}
                                        </Text>
                                    )
                                }
                            />
                        </List.Item>
                    )}
                />
            )}
            {previewEntry && (
                <FilePreview
                    mountId={mountId}
                    projectId={projectId}
                    entry={previewEntry}
                    onClose={() => setPreviewEntry(null)}
                />
            )}
        </div>
    )
}

const MountsTab = ({sessionId, artifactId}: {sessionId: string; artifactId?: string | null}) => {
    const projectId = useAtomValue(projectIdAtom)

    const mountsQuery = useQuery({
        queryKey: ["session-inspector", "mounts", projectId, sessionId],
        queryFn: () => fetchMounts(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    const agentMountQuery = useQuery({
        queryKey: ["session-inspector", "agent-mount", projectId, artifactId],
        queryFn: () => fetchAgentMount(artifactId!, projectId),
        enabled: Boolean(artifactId),
        refetchOnWindowFocus: false,
    })

    const mounts = mountsQuery.data?.mounts ?? []

    // File ops need a concrete mount id; a mount row without one can't be browsed.
    const mountsWithId = mounts.filter((mount): mount is typeof mount & {id: string} =>
        Boolean(mount.id),
    )
    const agentMountId = agentMountQuery.data?.id

    // The session mount lives inside the agent's durable folder (the runner symlinks it in as
    // `agent-files/`), so render it nested under the agent-files panel rather than as a sibling
    // section. Presentation only: each mount keeps its own id and its own file-listing query;
    // this only changes how the two are grouped on screen.
    const sessionMountsSection = mountsQuery.isLoading ? (
        <Skeleton active />
    ) : mountsQuery.error ? (
        <Alert type="error" message="Failed to load mounts" showIcon />
    ) : mountsWithId.length ? (
        <Collapse
            size="small"
            items={mountsWithId.map((mount) => ({
                key: mount.id,
                label: (
                    <div className="flex flex-col">
                        <span>{mount.name ?? mount.slug ?? mount.id}</span>
                        <Text type="secondary" className="text-xs font-mono">
                            {mount.id}
                        </Text>
                    </div>
                ),
                // Antd lazily mounts panel children on first expand, so this is when the listing query fires.
                children: <MountFilesPanel mountId={mount.id} projectId={projectId} />,
            }))}
        />
    ) : (
        <Empty description="No mounts bound to this session" image={Empty.PRESENTED_IMAGE_SIMPLE} />
    )

    return (
        <div className="flex flex-col gap-4">
            {artifactId ? (
                agentMountQuery.isLoading ? (
                    <Skeleton active />
                ) : agentMountQuery.error ? (
                    <Alert type="error" message="Failed to load agent files" showIcon />
                ) : agentMountId ? (
                    <Collapse
                        size="small"
                        items={[
                            {
                                key: agentMountId,
                                label: "Agent files",
                                children: (
                                    <div className="flex flex-col gap-3">
                                        <MountFilesPanel
                                            mountId={agentMountId}
                                            projectId={projectId}
                                        />
                                        <div className="flex flex-col gap-2 border-0 border-l-2 border-solid border-colorBorderSecondary pl-3">
                                            <Text
                                                type="secondary"
                                                className="text-xs font-medium uppercase tracking-wide"
                                            >
                                                Session (this conversation)
                                            </Text>
                                            {sessionMountsSection}
                                        </div>
                                    </div>
                                ),
                            },
                        ]}
                    />
                ) : (
                    <div className="flex flex-col gap-3">
                        <Text type="secondary">No agent files yet.</Text>
                        {sessionMountsSection}
                    </div>
                )
            ) : (
                sessionMountsSection
            )}
        </div>
    )
}

export default MountsTab

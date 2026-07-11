import {useMemo, useState} from "react"

import {
    deriveMountRows,
    mountBreadcrumbs,
    queryMountFiles,
    readMountFile,
} from "@agenta/entities/session"
import {CaretRight, File, Folder, House} from "@phosphor-icons/react"
import {useQuery} from "@tanstack/react-query"
import {Alert, Breadcrumb, Button, Empty, List, Skeleton, Typography} from "antd"
import {useAtomValue} from "jotai"

import {projectIdAtom} from "@/oss/state/project"

import {fetchMounts} from "../api"

const {Text} = Typography

const humanSize = (bytes?: number): string => {
    if (bytes == null) return ""
    if (bytes < 1024) return `${bytes} B`
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`
    return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

/** Read-only file browser for ONE mount: the whole tree is fetched once, then drilled client-side
 * (deriveMountRows) so folder navigation is instant; clicking a file previews its text content. */
const MountFileBrowser = ({mountId}: {mountId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const [path, setPath] = useState("")
    const [filePath, setFilePath] = useState<string | null>(null)

    const {data, isLoading, error} = useQuery({
        queryKey: ["session-inspector", "mount-files", projectId, mountId],
        queryFn: () => queryMountFiles({mountId, projectId: projectId ?? "", lowPriority: true}),
        enabled: Boolean(mountId && projectId),
        refetchOnWindowFocus: false,
    })

    const rows = useMemo(() => deriveMountRows(data ?? [], path), [data, path])
    const crumbs = useMemo(() => mountBreadcrumbs(path), [path])

    const file = useQuery({
        queryKey: ["session-inspector", "mount-file", projectId, mountId, filePath],
        queryFn: () => readMountFile({mountId, projectId: projectId ?? "", path: filePath ?? ""}),
        enabled: Boolean(mountId && projectId && filePath),
        refetchOnWindowFocus: false,
    })

    if (isLoading) return <Skeleton active />
    // `data === null` means the fetch failed (e.g. the object store isn't configured — the API
    // 503s "Mount storage backend is not configured"); an empty mount is `[]`, handled below.
    if (error || data === null)
        return (
            <Alert
                type="warning"
                showIcon
                message="Couldn't load mount files"
                description={
                    <span className="text-xs">
                        The mount object store may not be configured on this deployment.
                    </span>
                }
            />
        )

    return (
        <div className="flex flex-col gap-2">
            <Breadcrumb
                items={[
                    {
                        title: (
                            <Button
                                type="text"
                                size="small"
                                icon={<House size={13} />}
                                className="!h-5 !px-1"
                                onClick={() => {
                                    setPath("")
                                    setFilePath(null)
                                }}
                            />
                        ),
                    },
                    ...crumbs.map((c) => ({
                        title: (
                            <Button
                                type="text"
                                size="small"
                                className="!h-5 !px-1 !text-xs"
                                onClick={() => {
                                    setPath(c.path)
                                    setFilePath(null)
                                }}
                            >
                                {c.name}
                            </Button>
                        ),
                    })),
                    ...(filePath
                        ? [{title: <span className="text-xs">{filePath.split("/").pop()}</span>}]
                        : []),
                ]}
            />

            {filePath ? (
                <div className="flex flex-col gap-2">
                    <Button
                        type="link"
                        size="small"
                        className="!h-5 self-start !px-0 !text-xs"
                        onClick={() => setFilePath(null)}
                    >
                        ← Back to files
                    </Button>
                    {file.isLoading ? (
                        <Skeleton active paragraph={{rows: 6}} />
                    ) : file.data ? (
                        <pre className="m-0 max-h-[55vh] overflow-auto rounded bg-colorFillQuaternary p-2 text-xs">
                            {file.data}
                        </pre>
                    ) : (
                        <Empty
                            image={Empty.PRESENTED_IMAGE_SIMPLE}
                            description={<span className="text-xs">No text preview available</span>}
                        />
                    )}
                </div>
            ) : rows.length === 0 ? (
                <Empty
                    image={Empty.PRESENTED_IMAGE_SIMPLE}
                    description={<span className="text-xs">Empty folder</span>}
                />
            ) : (
                <List
                    size="small"
                    dataSource={rows}
                    renderItem={(row) => (
                        <List.Item
                            className="!cursor-pointer !px-1 hover:bg-colorFillTertiary"
                            onClick={() =>
                                row.isFolder ? setPath(row.path) : setFilePath(row.path)
                            }
                        >
                            <div className="flex w-full items-center gap-2">
                                {row.isFolder ? (
                                    <Folder size={15} weight="fill" className="text-colorWarning" />
                                ) : (
                                    <File size={15} className="text-colorTextTertiary" />
                                )}
                                <Text className="!text-xs" ellipsis={{tooltip: row.name}}>
                                    {row.name}
                                </Text>
                                <span className="ml-auto flex items-center gap-1">
                                    {!row.isFolder && (
                                        <Text type="secondary" className="!text-[11px]">
                                            {humanSize(row.size)}
                                        </Text>
                                    )}
                                    {row.isFolder && (
                                        <CaretRight
                                            size={12}
                                            className="text-colorTextQuaternary"
                                        />
                                    )}
                                </span>
                            </div>
                        </List.Item>
                    )}
                />
            )}
        </div>
    )
}

const MountsTab = ({sessionId}: {sessionId: string}) => {
    const projectId = useAtomValue(projectIdAtom)
    const [mountId, setMountId] = useState<string | null>(null)

    const {data, isLoading, error} = useQuery({
        queryKey: ["session-inspector", "mounts", projectId, sessionId],
        queryFn: () => fetchMounts(sessionId, projectId),
        enabled: Boolean(sessionId),
        refetchOnWindowFocus: false,
    })

    if (isLoading) return <Skeleton active />
    if (error) return <Alert type="error" message="Failed to load mounts" showIcon />

    const mounts = data?.mounts ?? []
    if (!mounts.length) return <Empty description="No mounts bound to this session" />

    if (mountId) {
        const mount = mounts.find((m) => m.id === mountId)
        return (
            <div className="flex flex-col gap-2">
                <Button
                    type="link"
                    size="small"
                    className="!h-5 self-start !px-0 !text-xs"
                    onClick={() => setMountId(null)}
                >
                    ← All mounts
                </Button>
                <Text strong className="!text-xs">
                    {mount?.name ?? mount?.slug ?? mountId}
                </Text>
                <MountFileBrowser mountId={mountId} />
            </div>
        )
    }

    return (
        <List
            size="small"
            dataSource={mounts}
            renderItem={(mount) => (
                <List.Item
                    className="!cursor-pointer !px-1 hover:bg-colorFillTertiary"
                    onClick={() => mount.id && setMountId(mount.id)}
                >
                    <List.Item.Meta
                        avatar={<Folder size={16} weight="fill" className="text-colorWarning" />}
                        title={
                            <span className="text-xs">{mount.name ?? mount.slug ?? mount.id}</span>
                        }
                        description={
                            <Text type="secondary" className="!text-[11px] font-mono">
                                {mount.id}
                            </Text>
                        }
                    />
                    <CaretRight size={12} className="text-colorTextQuaternary" />
                </List.Item>
            )}
        />
    )
}

export default MountsTab

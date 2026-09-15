import {useState} from "react"

import {type DriveTreeNode} from "@agenta/entities/drive"
import {
    DriveHeader,
    DriveToolbar,
    DriveTypeMark,
    FileTile,
    FolderList,
    FolderTile,
} from "@agenta/entity-ui/drive"
import type {Meta, StoryObj} from "@storybook/nextjs"

// The Files pane's chrome and content pieces with static props — the states a reviewer cannot
// reach by clicking a live drive: a saving markdown row, a read-only mount, a search-forced tree,
// the preview label for every kind.
const meta = {
    title: "@agenta/entity-ui/Drive/Files pane chrome",
    parameters: {layout: "padded"},
} satisfies Meta

export default meta
type Story = StoryObj

const noop = () => undefined
const FILE_ACTIONS = {
    onRename: noop,
    renameTo: async () => true,
    validateName: () => null,
    onDuplicate: noop,
    onDelete: noop,
}
const copyText = (text: string) => void text

const headerBase = {
    rootLabel: "cwd",
    onNavigate: noop,
    canGoBack: true,
    canGoForward: false,
    onBack: noop,
    onForward: noop,
    copyText,
    ids: [],
    showOrigin: true,
    showTemporary: false,
    onToggleTemporary: noop,
    showHidden: false,
    onToggleHidden: noop,
    inGitScope: true,
    showGitignored: false,
    onToggleGitignored: noop,
    treeVisible: true,
    searchActive: false,
    onToggleTree: noop,
}

const Frame = ({children}: {children: React.ReactNode}) => (
    <div className="w-[720px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
        {children}
    </div>
)

/** Row 1 on a folder, a file, the root, and a docked pane with the collapse control. */
export const Row1: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <Frame>
                <DriveHeader {...headerBase} selectedPath="agent-files/articles" isFolder />
            </Frame>
            <Frame>
                <DriveHeader
                    {...headerBase}
                    selectedPath="agent-files/article.md"
                    isFolder={false}
                />
            </Frame>
            <Frame>
                <DriveHeader {...headerBase} selectedPath="" isFolder canGoBack={false} />
            </Frame>
            <Frame>
                <DriveHeader
                    {...headerBase}
                    selectedPath="research"
                    isFolder
                    treeVisible={false}
                    searchActive={false}
                    onClose={noop}
                    closeVariant="collapse"
                />
            </Frame>
            <Frame>
                <DriveHeader
                    {...headerBase}
                    selectedPath="research"
                    isFolder
                    searchActive
                    partialErrored
                    onRetry={noop}
                />
            </Frame>
        </div>
    ),
}

const Row2Folder = () => {
    const [view, setView] = useState<"grid" | "list">("grid")
    const [sort, setSort] = useState<"name" | "modified" | "size">("name")
    return (
        <DriveToolbar
            variant="folder"
            view={view}
            setView={setView}
            sort={sort}
            setSort={setSort}
            actions={{onNewFolder: noop, onNewFile: noop, onUpload: noop}}
            onDownloadAll={noop}
        />
    )
}

/** Row 2 in its three shapes: folder, markdown (clean / saving / failed save) and preview. */
export const Row2: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            <Frame>
                <Row2Folder />
            </Frame>
            <Frame>
                <DriveToolbar
                    variant="markdown"
                    toolbarRef={noop}
                    mode="rendered"
                    setMode={noop}
                    status="clean"
                    onRetry={noop}
                    actions={FILE_ACTIONS}
                />
            </Frame>
            <Frame>
                <DriveToolbar
                    variant="markdown"
                    toolbarRef={noop}
                    mode="rendered"
                    setMode={noop}
                    status="saving"
                    onRetry={noop}
                    actions={FILE_ACTIONS}
                />
            </Frame>
            <Frame>
                <DriveToolbar
                    variant="markdown"
                    toolbarRef={noop}
                    mode="source"
                    setMode={noop}
                    status="error"
                    onRetry={noop}
                />
            </Frame>
            <Frame>
                <DriveToolbar variant="other" path="agent-files/migrate.py" />
            </Frame>
        </div>
    ),
}

const NODES: DriveTreeNode[] = [
    {name: "articles", path: "articles", isFolder: true, itemCount: 3, children: []},
    {name: "skills", path: "skills", isFolder: true, itemCount: 2, children: []},
    {
        name: "agent.json",
        path: "agent.json",
        isFolder: false,
        size: 11980,
        modifiedAt: Date.now() - 3.6e6,
        children: [],
    },
    {
        name: "article.md",
        path: "article.md",
        isFolder: false,
        size: 6963,
        modifiedAt: Date.now() - 7.2e6,
        children: [],
    },
    {name: "brand-guide.pdf", path: "brand-guide.pdf", isFolder: false, size: 839680, children: []},
    {
        name: "migrate_article_writer.py",
        path: "migrate_article_writer.py",
        isFolder: false,
        size: 18636,
        children: [],
    },
    {name: "seo-keywords.csv", path: "seo-keywords.csv", isFolder: false, size: 4506, children: []},
    {name: "preview.html", path: "preview.html", isFolder: false, size: 23040, children: []},
    {name: "screenshot.png", path: "screenshot.png", isFolder: false, size: 151552, children: []},
    {name: "Dockerfile", path: "Dockerfile", isFolder: false, size: 412, children: []},
]

/** The Finder tiles — every kind's type mark, a selected tile, a hidden file. */
export const Tiles: Story = {
    render: () => (
        <div className="grid w-[640px] grid-cols-5 gap-x-2 gap-y-1">
            {NODES.map((n) =>
                n.isFolder ? (
                    <FolderTile
                        key={n.path}
                        node={n}
                        onOpen={noop}
                        selected={n.name === "skills"}
                    />
                ) : (
                    <FileTile
                        key={n.path}
                        node={n}
                        onOpen={noop}
                        selected={n.name === "article.md"}
                    />
                ),
            )}
            <FileTile
                node={{name: ".env", path: ".env", isFolder: false, size: 88, children: []}}
                onOpen={noop}
            />
        </div>
    ),
}

/** The list view on the shared ListTable. */
export const List: Story = {
    render: () => (
        <div className="h-[360px] w-[720px] overflow-hidden rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
            <div className="flex h-full flex-col">
                <FolderList
                    nodes={NODES}
                    selectedPath="article.md"
                    onOpen={noop}
                    onCopyPath={noop}
                    onDownload={noop}
                />
            </div>
        </div>
    ),
}

/** The type mark at its three sizes. */
export const TypeMarks: Story = {
    render: () => (
        <div className="flex flex-col gap-4">
            {(["tile", "mini", "badge"] as const).map((size) => (
                <div key={size} className="flex items-center gap-4">
                    {NODES.filter((n) => !n.isFolder).map((n) => (
                        <DriveTypeMark key={n.path} path={n.path} size={size} />
                    ))}
                </div>
            ))}
        </div>
    ),
}

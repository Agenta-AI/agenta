import {useMemo, useState} from "react"

import {
    browseRows,
    buildFolderTree,
    filterTreeBySearch,
    folderChain,
    indexFolders,
    siblingFolders,
    type Folder,
    type Workflow,
} from "@agenta/entities/workflow"
import type {Meta, StoryObj} from "@storybook/nextjs"
import {expect, userEvent, within} from "storybook/test"

import {FolderNameDialog} from "../../../mobile/src/features/prompts/dialogs/FolderNameDialog"
import {
    flattenTree,
    promptType,
    type PromptItem,
} from "../../../mobile/src/features/prompts/promptRow"
import {PromptsView} from "../../../mobile/src/features/prompts/PromptsView"
import type {PromptsEmptyKind} from "../../../mobile/src/features/prompts/usePromptsBrowser"

type ViewProps = Parameters<typeof PromptsView>[0]

interface StoryState {
    folders: Folder[]
    prompts: PromptItem[]
    folderId?: string | null
    search?: string
    isPending?: boolean
    isError?: boolean
    readOnly?: boolean
}

const folder = (id: string, name: string, parent_id: string | null = null): Folder => ({
    id,
    name,
    slug: name.toLowerCase().replace(/\s+/g, "-"),
    parent_id,
    updated_at: "2026-10-12T09:30:00Z",
})

const prompt = (
    id: string,
    name: string,
    folder_id: string | null,
    flags: Partial<NonNullable<Workflow["flags"]>> = {},
): PromptItem =>
    ({
        id,
        name,
        slug: id,
        folder_id,
        flags: flags as Workflow["flags"],
        updated_at: "2026-10-20T14:05:00Z",
        created_at: `2026-10-0${id.length}T08:00:00Z`,
        type: promptType(flags as Workflow["flags"]),
    }) as PromptItem

const FOLDERS = [
    folder("support", "Support"),
    folder("sales", "Sales"),
    folder("emails", "Emails", "support"),
    folder("refunds", "Refunds", "emails"),
]
const PROMPTS = [
    prompt("p1", "Summarize a ticket", null, {is_chat: false}),
    prompt("p2", "Support assistant", "support", {is_chat: true}),
    prompt("p3", "Welcome email", "emails"),
    prompt("p4", "Refund reply", "refunds"),
    prompt("p5", "Webhook relay", null, {is_custom: true}),
]

const Host = ({
    folders,
    prompts,
    folderId: initialFolder = null,
    search: initialSearch = "",
    isPending = false,
    isError = false,
    readOnly = false,
}: StoryState) => {
    const [folderId, setFolderId] = useState<string | null>(initialFolder)
    const [search, setSearch] = useState(initialSearch)
    const [newFolderOpen, setNewFolderOpen] = useState(false)
    const foldersById = useMemo(() => indexFolders(folders), [folders])
    const term = search.trim()
    const rows = useMemo(
        () =>
            flattenTree(
                term
                    ? filterTreeBySearch(buildFolderTree(folders, prompts), term)
                    : browseRows({folders, prompts, folderId}),
            ),
        [folderId, folders, prompts, term],
    )
    let emptyKind: PromptsEmptyKind | null = null
    if (!isPending && !isError && rows.length === 0) {
        emptyKind = term ? "search" : folderId ? "folder" : "project"
    }
    const noop = () => undefined
    const props: ViewProps = {
        chain: folderChain(foldersById, folderId),
        siblingsOf: (parentId) => siblingFolders(foldersById, parentId),
        rows,
        search,
        onSearchChange: setSearch,
        isPending,
        isError,
        emptyKind,
        canEditFolders: !readOnly,
        canEditPrompts: !readOnly,
        rowActions: {
            openFolder: (row) => setFolderId(row.folder.id),
            rename: noop,
            move: noop,
            remove: noop,
        },
        onOpenFolder: setFolderId,
        openDialog: (dialog) => dialog.kind === "newFolder" && setNewFolderOpen(true),
        onRetry: noop,
    }
    return (
        <div className="mx-auto w-full max-w-3xl text-foreground">
            <PromptsView {...props} />
            <FolderNameDialog
                open={newFolderOpen}
                mode="create"
                pathFor={(name) => name.toLowerCase()}
                onSubmit={() => setNewFolderOpen(false)}
                onClose={() => setNewFolderOpen(false)}
            />
        </div>
    )
}

const meta = {
    title: "@agenta/mobile/Developer/Prompts/PromptsScreen",
    component: Host,
    parameters: {layout: "padded"},
} satisfies Meta<typeof Host>

export default meta
type Story = StoryObj<typeof meta>

export const Loading: Story = {args: {folders: [], prompts: [], isPending: true}}

export const EmptyProject: Story = {args: {folders: [], prompts: []}}

export const EmptyFolder: Story = {args: {folders: FOLDERS, prompts: [], folderId: "sales"}}

export const Root: Story = {
    args: {folders: FOLDERS, prompts: PROMPTS},
    play: async ({canvasElement}) => {
        const canvas = within(canvasElement)
        await userEvent.click(canvas.getByText("Support"))
        await expect(canvas.getByLabelText("breadcrumb")).toHaveTextContent("Support")
        const caret = canvas.getByRole("button", {name: "Support Actions"})
        await userEvent.click(caret)
        const menu = within(document.body)
        await userEvent.click(await menu.findByRole("menuitem", {name: "New folder"}))
        await expect(await menu.findByPlaceholderText("Untitled folder")).toBeVisible()
    },
}

export const InFolder: Story = {args: {folders: FOLDERS, prompts: PROMPTS, folderId: "refunds"}}

export const Search: Story = {args: {folders: FOLDERS, prompts: PROMPTS, search: "email"}}

export const SearchNoMatch: Story = {args: {folders: FOLDERS, prompts: PROMPTS, search: "zzz"}}

export const ReadOnly: Story = {args: {folders: FOLDERS, prompts: PROMPTS, readOnly: true}}

export const LoadError: Story = {args: {folders: [], prompts: [], isError: true}}

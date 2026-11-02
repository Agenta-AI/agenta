import {useEffect, useMemo, useState} from "react"

import {buildFolderTree, type Folder, type FolderTreeNode} from "@agenta/entities/workflow"
import {
    Button,
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@agenta/ui/ui"
import {FolderIcon} from "@phosphor-icons/react"

import {promptsCopy} from "../promptsCopy"

type FolderNode = Extract<FolderTreeNode, {kind: "folder"}>

const TreeRows = ({
    nodes,
    depth,
    selectedId,
    isDisabled,
    onSelect,
}: {
    nodes: FolderTreeNode[]
    depth: number
    selectedId: string | null
    isDisabled: (id: string) => boolean
    onSelect: (id: string) => void
}) => (
    <>
        {nodes
            .filter((node): node is FolderNode => node.kind === "folder")
            .map((node) => (
                <li key={node.id} role="none">
                    <button
                        type="button"
                        role="treeitem"
                        aria-selected={selectedId === node.id}
                        aria-level={depth + 1}
                        disabled={isDisabled(node.id)}
                        onClick={() => onSelect(node.id)}
                        style={{paddingLeft: 8 + depth * 16}}
                        className="flex min-h-9 w-full items-center gap-2 rounded-md border-0 bg-transparent py-1 pr-2 text-left text-sm text-foreground hover:bg-accent disabled:cursor-not-allowed disabled:text-muted-foreground disabled:opacity-60 disabled:hover:bg-transparent aria-selected:bg-accent aria-selected:font-medium"
                    >
                        <FolderIcon className="size-4 shrink-0" />
                        <span className="min-w-0 truncate">{node.folder.name}</span>
                    </button>
                    <ul role="group" className="m-0 list-none p-0">
                        <TreeRows
                            nodes={node.children}
                            depth={depth + 1}
                            selectedId={selectedId}
                            isDisabled={isDisabled}
                            onSelect={onSelect}
                        />
                    </ul>
                </li>
            ))}
    </>
)

/**
 * Picks the folder an item goes into. Every folder shows, fully open; a folder the item cannot go
 * into is greyed out, so the confirm button only ever offers a move that works.
 */
export const MoveToFolderDialog = ({
    open,
    itemName,
    folders,
    initialSelectedId,
    isDisabled,
    pending = false,
    error,
    onConfirm,
    onClose,
}: {
    open: boolean
    itemName: string
    folders: readonly Folder[]
    /** The folder the item sits in now (or the folder itself, for a folder). */
    initialSelectedId: string | null
    isDisabled: (folderId: string) => boolean
    pending?: boolean
    error?: string | null
    onConfirm: (destinationId: string) => void
    onClose: () => void
}) => {
    const copy = promptsCopy.moveDialog
    const [selectedId, setSelectedId] = useState<string | null>(initialSelectedId)
    useEffect(() => {
        if (open) setSelectedId(initialSelectedId)
    }, [open, initialSelectedId])

    const tree = useMemo(() => buildFolderTree(folders, []), [folders])
    const destination = folders.find((folder) => folder.id === selectedId)
    const canConfirm = Boolean(destination) && !isDisabled(selectedId ?? "") && !pending

    return (
        <Dialog
            open={open}
            onOpenChange={(next) => {
                if (!next && !pending) onClose()
            }}
        >
            <DialogContent>
                <DialogHeader>
                    <DialogTitle>{copy.title}</DialogTitle>
                    <DialogDescription>{copy.moving(itemName)}</DialogDescription>
                </DialogHeader>
                <p className="m-0 text-sm font-medium text-foreground">{copy.selectLabel}</p>
                <ul
                    role="tree"
                    aria-label={copy.selectLabel}
                    className="m-0 max-h-64 list-none overflow-y-auto rounded-md border border-solid border-border p-1"
                >
                    <TreeRows
                        nodes={tree}
                        depth={0}
                        selectedId={selectedId}
                        isDisabled={isDisabled}
                        onSelect={setSelectedId}
                    />
                </ul>
                {error ? <p className="m-0 text-sm text-destructive">{error}</p> : null}
                <DialogFooter>
                    <Button variant="outline" disabled={pending} onClick={onClose}>
                        {copy.cancel}
                    </Button>
                    <Button
                        disabled={!canConfirm}
                        onClick={() => selectedId && onConfirm(selectedId)}
                    >
                        {pending ? "Working…" : copy.confirm(destination?.name ?? null)}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    )
}

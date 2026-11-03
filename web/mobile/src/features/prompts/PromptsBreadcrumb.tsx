import {Fragment} from "react"

import type {Folder} from "@agenta/entities/workflow"
import {
    Breadcrumb,
    BreadcrumbItem,
    BreadcrumbList,
    BreadcrumbPage,
    BreadcrumbSeparator,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuTrigger,
} from "@agenta/ui/ui"
import {
    CaretDownIcon,
    FolderIcon,
    FolderOpenIcon,
    FolderPlusIcon,
    FolderDashedIcon,
    HouseIcon,
    PencilSimpleIcon,
    TrashIcon,
} from "@phosphor-icons/react"

import type {PromptsDialog} from "./promptDialogState"
import {promptsCopy} from "./promptsCopy"

const CRUMB_BUTTON =
    "flex min-h-7 max-w-[40vw] cursor-pointer items-center gap-1 rounded-md border-0 bg-transparent px-1.5 text-sm text-muted-foreground hover:bg-accent hover:text-foreground"

const SiblingItems = ({
    siblings,
    activeId,
    onOpen,
}: {
    siblings: Folder[]
    activeId: string
    onOpen: (id: string) => void
}) => (
    <>
        {siblings.map((sibling) => (
            <DropdownMenuItem
                key={sibling.id}
                onSelect={() => onOpen(sibling.id)}
                className={sibling.id === activeId ? "font-semibold text-primary" : undefined}
            >
                {sibling.id === activeId ? <FolderOpenIcon size={16} /> : <FolderIcon size={16} />}
                <span className="truncate">{sibling.name}</span>
            </DropdownMenuItem>
        ))}
    </>
)

/**
 * The house button, then one segment per folder down to the open one. A segment whose parent has
 * other folders opens a menu of them; the last segment has a caret menu with the folder's verbs.
 */
export const PromptsBreadcrumb = ({
    chain,
    siblingsOf,
    canEditFolders,
    onOpenFolder,
    openDialog,
}: {
    chain: Folder[]
    siblingsOf: (parentId: string | null) => Folder[]
    canEditFolders: boolean
    onOpenFolder: (id: string | null) => void
    openDialog: (dialog: PromptsDialog) => void
}) => {
    const copy = promptsCopy.menu
    const atRoot = chain.length === 0

    return (
        <Breadcrumb className="min-w-0">
            <BreadcrumbList>
                <BreadcrumbItem>
                    <button
                        type="button"
                        aria-label={promptsCopy.rootLabel}
                        aria-current={atRoot ? "page" : undefined}
                        className={CRUMB_BUTTON}
                        onClick={() => onOpenFolder(null)}
                    >
                        <HouseIcon size={16} weight={atRoot ? "fill" : "regular"} />
                    </button>
                </BreadcrumbItem>
                {chain.map((folder, index) => {
                    const isLast = index === chain.length - 1
                    const siblings = siblingsOf(folder.parent_id ?? null)
                    const label = folder.name ?? ""
                    return (
                        <Fragment key={folder.id}>
                            <BreadcrumbSeparator />
                            <BreadcrumbItem>
                                {isLast ? (
                                    <BreadcrumbPage className="truncate font-medium text-foreground">
                                        {label}
                                    </BreadcrumbPage>
                                ) : siblings.length > 1 ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button type="button" className={CRUMB_BUTTON}>
                                                <span className="truncate">{label}</span>
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent align="start">
                                            <SiblingItems
                                                siblings={siblings}
                                                activeId={folder.id}
                                                onOpen={onOpenFolder}
                                            />
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : (
                                    <button
                                        type="button"
                                        className={CRUMB_BUTTON}
                                        onClick={() => onOpenFolder(folder.id)}
                                    >
                                        <span className="truncate">{label}</span>
                                    </button>
                                )}
                                {isLast && (siblings.length > 1 || canEditFolders) ? (
                                    <DropdownMenu>
                                        <DropdownMenuTrigger asChild>
                                            <button
                                                type="button"
                                                aria-label={`${label} ${promptsCopy.rowMenuLabel}`}
                                                className={CRUMB_BUTTON}
                                            >
                                                <CaretDownIcon size={14} />
                                            </button>
                                        </DropdownMenuTrigger>
                                        <DropdownMenuContent
                                            align="start"
                                            className="min-w-[180px]"
                                        >
                                            {siblings.length > 1 ? (
                                                <SiblingItems
                                                    siblings={siblings}
                                                    activeId={folder.id}
                                                    onOpen={onOpenFolder}
                                                />
                                            ) : null}
                                            {siblings.length > 1 && canEditFolders ? (
                                                <DropdownMenuSeparator />
                                            ) : null}
                                            {canEditFolders ? (
                                                <>
                                                    <DropdownMenuItem
                                                        onSelect={() =>
                                                            openDialog({
                                                                kind: "renameFolder",
                                                                folder,
                                                            })
                                                        }
                                                    >
                                                        <PencilSimpleIcon size={16} />
                                                        {copy.rename}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuItem
                                                        onSelect={() =>
                                                            openDialog({kind: "moveFolder", folder})
                                                        }
                                                    >
                                                        <FolderDashedIcon size={16} />
                                                        {copy.move}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        onSelect={() =>
                                                            openDialog({kind: "newFolder"})
                                                        }
                                                    >
                                                        <FolderPlusIcon size={16} />
                                                        {promptsCopy.newFolder}
                                                    </DropdownMenuItem>
                                                    <DropdownMenuSeparator />
                                                    <DropdownMenuItem
                                                        className="text-destructive focus:text-destructive"
                                                        onSelect={() =>
                                                            openDialog({
                                                                kind: "deleteFolder",
                                                                folder,
                                                            })
                                                        }
                                                    >
                                                        <TrashIcon size={16} />
                                                        {copy.delete}
                                                    </DropdownMenuItem>
                                                </>
                                            ) : null}
                                        </DropdownMenuContent>
                                    </DropdownMenu>
                                ) : null}
                            </BreadcrumbItem>
                        </Fragment>
                    )
                })}
            </BreadcrumbList>
        </Breadcrumb>
    )
}

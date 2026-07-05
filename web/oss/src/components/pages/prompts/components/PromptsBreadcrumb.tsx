import React, {useMemo} from "react"

import type {AppType} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuSeparator,
    DropdownMenuSub,
    DropdownMenuSubContent,
    DropdownMenuSubTrigger,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {
    CaretDownIcon,
    FolderDashedIcon,
    FolderIcon,
    FolderOpenIcon,
    PencilSimpleLineIcon,
    SquaresFourIcon,
    TrashIcon,
} from "@phosphor-icons/react"
import {Breadcrumb, BreadcrumbProps} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

import {getAppTypeIcon} from "../assets/iconHelpers"
import {FolderTreeNode} from "../assets/utils"

import PromptsHouseIcon from "./PromptsHouseIcon"
import SetupWorkflowIcon from "./SetupWorkflowIcon"

interface PromptsBreadcrumbProps {
    foldersById: Record<string, FolderTreeNode>
    currentFolderId: string | null
    onFolderChange?: (folderId: string | null) => void
    onNewPrompt?: (type: AppType) => void
    onSetupWorkflow?: () => void
    onNewFolder?: () => void
    onMoveFolder?: (folderId: string | null) => void
    onRenameFolder?: (folderId: string | null) => void
    onDeleteFolder?: (folderId: string | null) => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        width: "fit-content",
        backgroundColor: theme.colorPrimaryBg,
        borderRadius: theme.borderRadiusLG,
        padding: theme.paddingXXS,
        "& :not(.ant-breadcrumb-separator)": {
            cursor: "pointer",
        },
        "& .ant-breadcrumb-link": {
            transition: "all 0.2s ease-in-out",
            "&:hover": {
                textDecoration: "underline",
            },
        },
    },
}))

/**
 * Get sibling folders at a given level.
 * parentId=null -> root-level folders.
 */
const getSiblingFolders = (
    foldersById: Record<string, FolderTreeNode>,
    parentId: string | null,
): FolderTreeNode[] => {
    return Object.values(foldersById)
        .filter((f) => {
            const fParentId = f.parent_id ?? null
            return fParentId === parentId
        })
        .sort((a, b) => (a.name ?? "").localeCompare(b.name ?? ""))
}

const PromptsBreadcrumb = ({
    foldersById,
    currentFolderId,
    onFolderChange,
    onNewPrompt,
    onSetupWorkflow,
    onNewFolder,
    onMoveFolder,
    onRenameFolder,
    onDeleteFolder,
}: PromptsBreadcrumbProps) => {
    const classes = useStyles()

    const folderChain = useMemo(() => {
        if (!currentFolderId) return []

        const chain: FolderTreeNode[] = []
        let current: FolderTreeNode | undefined = foldersById[currentFolderId]

        while (current) {
            chain.push(current)
            const parentId = (current as any).parent_id as string | undefined
            current = parentId ? foldersById[parentId] : undefined
        }

        return chain.reverse()
    }, [currentFolderId, foldersById])

    const items: BreadcrumbProps["items"] = useMemo(() => {
        const isAtRoot = !currentFolderId

        const base: BreadcrumbProps["items"] = [
            {
                title: (
                    <Button className="w-5 h-5 m-0" variant="link" size="icon-sm">
                        {<PromptsHouseIcon active={isAtRoot} />}
                    </Button>
                ),
                onClick: () => onFolderChange?.(null),
            },
        ]

        folderChain.forEach((folder, index) => {
            const isLast = index === folderChain.length - 1
            const parentId = folder.parent_id ?? null
            const siblings = getSiblingFolders(foldersById, parentId)

            if (isLast) {
                base.push({
                    title: (
                        <div className="flex items-center gap-1">
                            <span>{folder.name}</span>
                            <DropdownMenu>
                                <DropdownMenuTrigger className="w-5 h-5 inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground">
                                    {<CaretDownIcon size={14} />}
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" sideOffset={4}>
                                    {siblings.map((sibling) => {
                                        const isActive = sibling.id === folder.id
                                        return (
                                            <DropdownMenuItem
                                                key={sibling.id}
                                                onClick={() => onFolderChange?.(sibling.id!)}
                                            >
                                                {isActive ? (
                                                    <FolderOpenIcon
                                                        size={14}
                                                        weight="fill"
                                                        className="text-primary"
                                                    />
                                                ) : (
                                                    <FolderIcon
                                                        size={14}
                                                        className="text-muted-foreground"
                                                    />
                                                )}
                                                <span
                                                    className={
                                                        isActive
                                                            ? "font-semibold text-primary"
                                                            : undefined
                                                    }
                                                >
                                                    {sibling.name}
                                                </span>
                                            </DropdownMenuItem>
                                        )
                                    })}
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem
                                        onClick={() => onRenameFolder?.(currentFolderId)}
                                    >
                                        <PencilSimpleLineIcon size={14} />
                                        Rename
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        onClick={() => onMoveFolder?.(currentFolderId)}
                                    >
                                        <FolderDashedIcon size={14} />
                                        Move
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuSub>
                                        <DropdownMenuSubTrigger>
                                            <SquaresFourIcon size={14} />
                                            New prompt
                                        </DropdownMenuSubTrigger>
                                        <DropdownMenuSubContent>
                                            <DropdownMenuItem onClick={() => onNewPrompt?.("chat")}>
                                                {getAppTypeIcon("chat")}
                                                Chat
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => onNewPrompt?.("completion")}
                                            >
                                                {getAppTypeIcon("completion")}
                                                Completion
                                            </DropdownMenuItem>
                                            <DropdownMenuItem
                                                onClick={() => onNewPrompt?.("agent")}
                                            >
                                                {getAppTypeIcon("agent")}
                                                Agent
                                            </DropdownMenuItem>
                                        </DropdownMenuSubContent>
                                    </DropdownMenuSub>
                                    <DropdownMenuItem onClick={() => onNewFolder?.()}>
                                        <FolderIcon size={14} />
                                        New folder
                                    </DropdownMenuItem>
                                    <DropdownMenuSeparator />
                                    <DropdownMenuItem onClick={() => onSetupWorkflow?.()}>
                                        <SetupWorkflowIcon />
                                        Set up workflow
                                    </DropdownMenuItem>
                                    <DropdownMenuItem
                                        variant="destructive"
                                        onClick={() => onDeleteFolder?.(currentFolderId)}
                                    >
                                        <TrashIcon size={14} />
                                        Delete
                                    </DropdownMenuItem>
                                </DropdownMenuContent>
                            </DropdownMenu>
                        </div>
                    ),
                })
            } else {
                base.push({
                    title:
                        siblings.length > 1 ? (
                            <DropdownMenu>
                                <DropdownMenuTrigger className="bg-transparent border-none p-0 cursor-pointer inline-flex items-center text-inherit">
                                    <span>{folder.name}</span>
                                </DropdownMenuTrigger>
                                <DropdownMenuContent align="start" sideOffset={4}>
                                    {siblings.map((sibling) => {
                                        const isActive = sibling.id === folder.id
                                        return (
                                            <DropdownMenuItem
                                                key={sibling.id}
                                                onClick={() => onFolderChange?.(sibling.id!)}
                                            >
                                                {isActive ? (
                                                    <FolderOpenIcon
                                                        size={14}
                                                        weight="fill"
                                                        className="text-primary"
                                                    />
                                                ) : (
                                                    <FolderIcon
                                                        size={14}
                                                        className="text-muted-foreground"
                                                    />
                                                )}
                                                <span
                                                    className={
                                                        isActive
                                                            ? "font-semibold text-primary"
                                                            : undefined
                                                    }
                                                >
                                                    {sibling.name}
                                                </span>
                                            </DropdownMenuItem>
                                        )
                                    })}
                                </DropdownMenuContent>
                            </DropdownMenu>
                        ) : (
                            folder.name
                        ),
                    onClick: siblings.length <= 1 ? () => onFolderChange?.(folder.id!) : undefined,
                })
            }
        })

        return base
    }, [
        currentFolderId,
        folderChain,
        foldersById,
        onFolderChange,
        onRenameFolder,
        onMoveFolder,
        onNewPrompt,
        onNewFolder,
        onSetupWorkflow,
        onDeleteFolder,
    ])

    return <Breadcrumb items={items} className={classes.container} />
}

export default PromptsBreadcrumb

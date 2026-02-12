import React, {useMemo} from "react"

import {
    CaretDownIcon,
    FolderDashedIcon,
    FolderIcon,
    FolderOpenIcon,
    HouseSimpleIcon,
    PencilSimpleLineIcon,
    SquaresFourIcon,
    TrashIcon,
} from "@phosphor-icons/react"
import {Breadcrumb, BreadcrumbProps, Button, Dropdown, MenuProps, theme} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

import {FolderTreeNode} from "../assets/utils"

import PromptsHouseIcon from "./PromptsHouseIcon"
import SetupWorkflowIcon from "./SetupWorkflowIcon"

interface PromptsBreadcrumbProps {
    foldersById: Record<string, FolderTreeNode>
    currentFolderId: string | null
    onFolderChange?: (folderId: string | null) => void
    onNewPrompt?: () => void
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
        "& .ant-dropdown-trigger": {
            display: "flex",
            alignItems: "center",
            gap: 4,
            "&:hover": {
                backgroundColor: "inherit",
            },
            "& .anticon-down": {
                fontSize: "10px !important",
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
    const {token} = theme.useToken()

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

    const actionItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "rename_folder",
                icon: <PencilSimpleLineIcon size={14} />,
                label: "Rename",
                onClick: () => onRenameFolder?.(currentFolderId),
            },
            {
                key: "move_folder",
                icon: <FolderDashedIcon size={14} />,
                label: "Move",
                onClick: () => onMoveFolder?.(currentFolderId),
            },
            {type: "divider"},
            {
                key: "new_prompt",
                icon: <SquaresFourIcon size={14} />,
                label: "New prompt",
                onClick: () => onNewPrompt?.(),
            },
            {
                key: "new_folder",
                icon: <FolderIcon size={14} />,
                label: "New folder",
                onClick: () => onNewFolder?.(),
            },
            {type: "divider"},
            {
                key: "setup_workflow",
                icon: <SetupWorkflowIcon />,
                label: "Set up workflow",
                onClick: () => onSetupWorkflow?.(),
            },
            {
                key: "delete_folder",
                icon: <TrashIcon size={14} />,
                label: "Delete",
                danger: true,
                onClick: () => onDeleteFolder?.(currentFolderId),
            },
        ],
        [
            currentFolderId,
            onDeleteFolder,
            onMoveFolder,
            onNewFolder,
            onNewPrompt,
            onRenameFolder,
            onSetupWorkflow,
        ],
    )

    /**
     * Build a flat sibling-folder menu for a breadcrumb segment.
     * Shows only folders (no apps) at one level — clean, no cascading.
     */
    const buildSiblingMenu = (
        parentId: string | null,
        activeFolderId: string | null,
        includeRoot?: boolean,
        extraItems?: MenuProps["items"],
    ): MenuProps["items"] => {
        const siblings = getSiblingFolders(foldersById, parentId)
        const items: MenuProps["items"] = []

        // "All prompts" root entry
        if (includeRoot) {
            items.push({
                key: "__root__",
                icon: <HouseSimpleIcon size={14} weight={!currentFolderId ? "fill" : "regular"} />,
                label: (
                    <span style={!currentFolderId ? {fontWeight: 600} : undefined}>
                        All prompts
                    </span>
                ),
                onClick: () => onFolderChange?.(null),
            })

            if (siblings.length > 0) {
                items.push({type: "divider"})
            }
        }

        siblings.forEach((folder) => {
            const isActive = folder.id === activeFolderId
            items.push({
                key: folder.id as string,
                icon: isActive ? (
                    <FolderOpenIcon size={14} weight="fill" style={{color: token.colorPrimary}} />
                ) : (
                    <FolderIcon size={14} style={{color: token.colorTextSecondary}} />
                ),
                label: (
                    <span
                        style={isActive ? {fontWeight: 600, color: token.colorPrimary} : undefined}
                    >
                        {folder.name}
                    </span>
                ),
                onClick: () => onFolderChange?.(folder.id as string),
            })
        })

        if (extraItems?.length && items.length > 0) {
            items.push({type: "divider"})
        }

        if (extraItems?.length) {
            items.push(...extraItems)
        }

        return items
    }

    const items: BreadcrumbProps["items"] = useMemo(() => {
        const isAtRoot = !currentFolderId

        const base: BreadcrumbProps["items"] = [
            {
                title: (
                    <Button
                        type="link"
                        className="w-5 h-5 m-0"
                        size="small"
                        icon={<PromptsHouseIcon active={isAtRoot} />}
                    />
                ),
                onClick: () => onFolderChange?.(null),
            },
        ]

        folderChain.forEach((folder, index) => {
            const isLast = index === folderChain.length - 1
            const parentId = folder.parent_id ?? null

            if (isLast) {
                const menuItems = buildSiblingMenu(parentId, folder.id ?? null, false, actionItems)

                base.push({
                    title: (
                        <div className="flex items-center gap-1">
                            <span>{folder.name}</span>
                            <Dropdown
                                trigger={["click"]}
                                styles={{root: {minWidth: 200}}}
                                menu={{items: menuItems}}
                                placement="bottomLeft"
                            >
                                <Button
                                    type="text"
                                    className="w-5 h-5"
                                    size="small"
                                    icon={<CaretDownIcon size={14} />}
                                />
                            </Dropdown>
                        </div>
                    ),
                })
            } else {
                const siblingMenu = buildSiblingMenu(parentId, folder.id ?? null)

                base.push({
                    title:
                        siblingMenu && siblingMenu.length > 1 ? (
                            <Dropdown
                                trigger={["click"]}
                                styles={{root: {minWidth: 200}}}
                                menu={{items: siblingMenu}}
                                placement="bottomLeft"
                            >
                                <span>{folder.name}</span>
                            </Dropdown>
                        ) : (
                            folder.name
                        ),
                    onClick:
                        !siblingMenu || siblingMenu.length <= 1
                            ? () => onFolderChange?.(folder.id!)
                            : undefined,
                })
            }
        })

        return base
    }, [actionItems, currentFolderId, folderChain, foldersById, onFolderChange, token])

    return <Breadcrumb items={items} className={classes.container} />
}

export default PromptsBreadcrumb

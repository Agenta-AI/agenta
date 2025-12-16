import React, {useMemo} from "react"

import {HomeFilled} from "@ant-design/icons"
import {
    CaretDownIcon,
    FolderDashedIcon,
    FolderIcon,
    PencilSimpleLineIcon,
    SquaresFourIcon,
    TrashIcon,
} from "@phosphor-icons/react"
import {Breadcrumb, BreadcrumbProps, Button, Dropdown, MenuProps} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme} from "@/oss/lib/Types"

import {FolderTreeNode} from "../assets/utils"

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
    homeButton: {
        "&:hover .anticon": {
            color: "#1C2C3D !important",
        },
    },
}))

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

    const actionItems: MenuProps["items"] = useMemo(
        () => [
            {
                key: "rename_folder",
                icon: <PencilSimpleLineIcon size={16} />,
                label: "Rename",
                onClick: () => onRenameFolder?.(currentFolderId),
            },
            {
                key: "move_folder",
                icon: <FolderDashedIcon size={16} />,
                label: "Move",
                onClick: () => onMoveFolder?.(currentFolderId),
            },
            {
                type: "divider",
            },
            {
                key: "new_prompt",
                icon: <SquaresFourIcon size={16} />,
                label: "New prompt",
                onClick: () => onNewPrompt?.(),
            },
            {
                key: "new_folder",
                icon: <FolderIcon size={16} />,
                label: "New folder",
                onClick: () => onNewFolder?.(),
            },
            {
                type: "divider",
            },
            {
                key: "setup_workflow",
                icon: <SetupWorkflowIcon />,
                label: "Set up workflow",
                onClick: () => onSetupWorkflow?.(),
            },
            {
                key: "delete_folder",
                icon: <TrashIcon size={16} />,
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

    const items: BreadcrumbProps["items"] = useMemo(() => {
        const base: BreadcrumbProps["items"] = [
            {
                title: (
                    <Button
                        type="link"
                        className={`w-5 h-5 m-0 ${classes.homeButton}`}
                        size="small"
                        icon={<HomeFilled style={{fontSize: 16, color: "#BDC7D1"}} />}
                    />
                ),
                onClick: () => onFolderChange?.(null),
            },
        ]

        folderChain.forEach((folder, index) => {
            const isLast = index === folderChain.length - 1

            base.push({
                title: isLast ? (
                    <div className="flex items-center gap-1">
                        <span>{folder.name}</span>
                        <Dropdown
                            trigger={["click"]}
                            overlayStyle={{width: 200}}
                            menu={{
                                items: actionItems,
                            }}
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
                ) : (
                    folder.name
                ),
                onClick: !isLast ? () => onFolderChange?.(folder.id!) : undefined,
            })
        })

        return base
    }, [actionItems, folderChain, onFolderChange])

    return <Breadcrumb items={items} className={classes.container} />
}

export default PromptsBreadcrumb

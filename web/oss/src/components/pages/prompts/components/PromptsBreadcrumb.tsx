import {Breadcrumb, BreadcrumbProps} from "antd"
import React, {useMemo} from "react"
import {useProjectData} from "@/oss/state/project"
import {FolderTreeNode} from "../assets/utils"
import {createUseStyles} from "react-jss"
import {JSSTheme} from "@/oss/lib/Types"
import {
    FolderDashedIcon,
    FolderIcon,
    PencilSimpleLineIcon,
    SquaresFourIcon,
    TrashIcon,
} from "@phosphor-icons/react"
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
    onDropOnRoot?: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        width: "fit-content",
        backgroundColor: theme.colorPrimaryBg,
        borderRadius: theme.borderRadiusLG,
        paddingLeft: theme.paddingXS,
        paddingRight: theme.paddingXS,
        "& :not(.ant-breadcrumb-separator)": {
            cursor: "pointer",
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
    onDropOnRoot,
}: PromptsBreadcrumbProps) => {
    const classes = useStyles()
    const {project} = useProjectData()

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
        const base: BreadcrumbProps["items"] = []

        if (project) {
            base.push({
                title: project.project_name,
                onClick: () => onFolderChange?.(null),
                onDragOver: (event) => event.preventDefault(),
                onDrop: (event) => {
                    event.preventDefault()
                    onDropOnRoot?.()
                },
            })
        }

        const actionItems = [
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
        ]

        folderChain.forEach((folder, index) => {
            const isLast = index === folderChain.length - 1

            base.push({
                title: folder.name,
                onClick: !isLast ? () => onFolderChange?.(folder.id!) : undefined,
                ...(isLast
                    ? {
                          menu: {
                              items: actionItems,
                              className: "w-[200px]",
                          },
                      }
                    : {}),
            })
        })

        return base
    }, [
        project,
        folderChain,
        onFolderChange,
        onNewPrompt,
        onSetupWorkflow,
        onNewFolder,
        onMoveFolder,
        onRenameFolder,
        onDeleteFolder,
    ])
    return <Breadcrumb items={items} className={classes.container} />
}

export default PromptsBreadcrumb

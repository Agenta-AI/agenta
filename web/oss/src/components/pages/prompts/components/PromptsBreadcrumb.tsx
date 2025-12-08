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

interface PromptsBreadcrumbProps {
    foldersById: Record<string, FolderTreeNode>
    currentFolderId: string | null
    onFolderChange?: (folderId: string | null) => void
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
            })
        }

        const actionItems = [
            {
                key: "rename_folder",
                icon: <PencilSimpleLineIcon size={16} />,
                label: "Rename",
                onClick: () => {},
                // disabled: disableFolderActions,
            },
            {
                key: "move_folder",
                icon: <FolderDashedIcon size={16} />,
                label: "Move",
                onClick: () => {},
                // disabled: disableFolderActions,
            },
            {
                type: "divider",
            },
            {
                key: "new_prompt",
                icon: <SquaresFourIcon size={16} />,
                label: "New prompt",
                onClick: () => {},
            },
            {
                key: "new_folder",
                icon: <FolderIcon size={16} />,
                label: "New folder",
                onClick: () => {},
            },
            {
                type: "divider",
            },
            {
                key: "setup_workflow",
                icon: (
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="16"
                        height="16"
                        viewBox="0 0 16 16"
                        fill="none"
                    >
                        <path
                            d="M13.5 2.5H2.5C2.23478 2.5 1.98043 2.60536 1.79289 2.79289C1.60536 2.98043 1.5 3.23478 1.5 3.5V12.5C1.5 12.7652 1.60536 13.0196 1.79289 13.2071C1.98043 13.3946 2.23478 13.5 2.5 13.5H13.5C13.7652 13.5 14.0196 13.3946 14.2071 13.2071C14.3946 13.0196 14.5 12.7652 14.5 12.5V3.5C14.5 3.23478 14.3946 2.98043 14.2071 2.79289C14.0196 2.60536 13.7652 2.5 13.5 2.5ZM5.8 9.1C5.90609 9.17957 5.97622 9.29801 5.99497 9.42929C6.01373 9.56056 5.97957 9.69391 5.9 9.8C5.82044 9.90609 5.70199 9.97622 5.57071 9.99498C5.43944 10.0137 5.30609 9.97956 5.2 9.9L3.2 8.4C3.1379 8.35343 3.0875 8.29303 3.05279 8.22361C3.01807 8.15418 3 8.07762 3 8C3 7.92238 3.01807 7.84582 3.05279 7.77639C3.0875 7.70697 3.1379 7.64657 3.2 7.6L5.2 6.1C5.30609 6.02043 5.43944 5.98627 5.57071 6.00503C5.70199 6.02378 5.82044 6.09391 5.9 6.2C5.97957 6.30609 6.01373 6.43944 5.99497 6.57071C5.97622 6.70199 5.90609 6.82044 5.8 6.9L4.33313 8L5.8 9.1ZM9.48063 4.6375L7.48063 11.6375C7.46358 11.7018 7.43389 11.762 7.3933 11.8146C7.35271 11.8672 7.30203 11.9113 7.24423 11.9441C7.18642 11.9769 7.12265 11.9979 7.05665 12.0058C6.99064 12.0136 6.92373 12.0083 6.85982 11.99C6.79591 11.9717 6.73628 11.9409 6.68444 11.8993C6.63259 11.8577 6.58956 11.8062 6.55786 11.7477C6.52616 11.6893 6.50643 11.6251 6.49982 11.559C6.49321 11.4928 6.49986 11.426 6.51937 11.3625L8.51937 4.3625C8.55781 4.23733 8.64382 4.13224 8.75891 4.0698C8.87399 4.00736 9.00898 3.99256 9.13487 4.02857C9.26075 4.06459 9.36749 4.14855 9.43214 4.26241C9.49679 4.37627 9.5142 4.51094 9.48063 4.6375ZM12.8 8.4L10.8 9.9C10.6939 9.97956 10.5606 10.0137 10.4293 9.99498C10.298 9.97622 10.1796 9.90609 10.1 9.8C10.0204 9.69391 9.98627 9.56056 10.005 9.42929C10.0238 9.29801 10.0939 9.17957 10.2 9.1L11.6669 8L10.2 6.9C10.1475 6.8606 10.1032 6.81125 10.0698 6.75475C10.0363 6.69825 10.0143 6.63571 10.005 6.57071C9.99574 6.50571 9.99935 6.43952 10.0156 6.37591C10.0319 6.3123 10.0606 6.25253 10.1 6.2C10.1394 6.14747 10.1888 6.10322 10.2453 6.06976C10.3018 6.03631 10.3643 6.01431 10.4293 6.00503C10.4943 5.99574 10.5605 5.99935 10.6241 6.01564C10.6877 6.03194 10.7475 6.0606 10.8 6.1L12.8 7.6C12.8621 7.64657 12.9125 7.70697 12.9472 7.77639C12.9819 7.84582 13 7.92238 13 8C13 8.07762 12.9819 8.15418 12.9472 8.22361C12.9125 8.29303 12.8621 8.35343 12.8 8.4Z"
                            fill="#1C2C3D"
                        />
                    </svg>
                ),
                label: "Set up workflow",
                onClick: () => {},
            },
            {
                key: "delete_folder",
                icon: <TrashIcon size={16} />,
                label: "Delete",
                danger: true,
                onClick: () => {},
                // disabled: disableFolderActions,
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
    }, [project, folderChain, onFolderChange])

    return <Breadcrumb items={items} className={classes.container} />
}

export default PromptsBreadcrumb

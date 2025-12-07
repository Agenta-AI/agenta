import {Breadcrumb, BreadcrumbProps} from "antd"
import React, {useMemo} from "react"
import {useProjectData} from "@/oss/state/project"
import {FolderTreeNode} from "../assets/utils"

interface PromptsBreadcrumbProps {
    foldersById: Record<string, FolderTreeNode>
    currentFolderId: string | null
    onFolderChange?: (folderId: string | null) => void
}

const PromptsBreadcrumb = ({
    foldersById,
    currentFolderId,
    onFolderChange,
}: PromptsBreadcrumbProps) => {
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

        folderChain.forEach((folder, index) => {
            const isLast = index === folderChain.length - 1

            base.push({
                title: folder.name,
                onClick: !isLast ? () => onFolderChange?.(folder.id!) : undefined,
            })
        })

        return base
    }, [project, folderChain, onFolderChange])

    return <Breadcrumb items={items} />
}

export default PromptsBreadcrumb

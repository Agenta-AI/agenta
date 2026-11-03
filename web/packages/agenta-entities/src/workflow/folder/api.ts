/**
 * Prompt folder calls (`/folders` and the folder id of a workflow), through the generated
 * client. Folder answers are checked with the zod schemas before the screens read them.
 */
import {getFoldersClient, getWorkflowsClient} from "@agenta/sdk/resources"

import {safeParseWithLogging} from "../../shared"

import {
    FOLDER_KIND_APPLICATIONS,
    folderResponseSchema,
    foldersResponseSchema,
    type Folder,
} from "./schema"

const projectScopedRequest = (projectId: string) => ({queryParams: {project_id: projectId}})

/**
 * Folders of a project. `parentId` is `null` for the root folders, an id for the subfolders of
 * that folder, and left out for every folder of the project. A bad answer gives an empty list.
 */
export const queryFolders = async ({
    projectId,
    parentId,
}: {
    projectId: string
    parentId?: string | null
}): Promise<Folder[]> => {
    const response = await getFoldersClient().queryFolders(
        {folder: parentId === undefined ? {} : {parent_id: parentId}},
        projectScopedRequest(projectId),
    )
    const data = safeParseWithLogging(foldersResponseSchema, response, "[queryFolders]")
    return data?.folders ?? []
}

export const createFolder = async ({
    projectId,
    name,
    slug,
    parentId,
}: {
    projectId: string
    name: string
    slug: string
    parentId: string | null
}): Promise<Folder | null> => {
    const response = await getFoldersClient().createFolder(
        {folder: {name, slug, kind: FOLDER_KIND_APPLICATIONS, parent_id: parentId}},
        projectScopedRequest(projectId),
    )
    return safeParseWithLogging(folderResponseSchema, response, "[createFolder]")?.folder ?? null
}

export const renameFolder = async ({
    projectId,
    folderId,
    name,
    slug,
}: {
    projectId: string
    folderId: string
    name: string
    slug: string
}): Promise<Folder | null> => {
    const response = await getFoldersClient().editFolder(
        {folder_id: folderId, folder: {id: folderId, name, slug}},
        projectScopedRequest(projectId),
    )
    return safeParseWithLogging(folderResponseSchema, response, "[renameFolder]")?.folder ?? null
}

/** The server rebuilds the path from the slug, so the move repeats the name and the slug. */
export const moveFolder = async ({
    projectId,
    folder,
    destinationId,
}: {
    projectId: string
    folder: {id: string; name?: string | null; slug?: string | null}
    destinationId: string
}): Promise<Folder | null> => {
    const response = await getFoldersClient().editFolder(
        {
            folder_id: folder.id,
            folder: {
                id: folder.id,
                name: folder.name,
                slug: folder.slug,
                kind: FOLDER_KIND_APPLICATIONS,
                parent_id: destinationId,
            },
        },
        projectScopedRequest(projectId),
    )
    return safeParseWithLogging(folderResponseSchema, response, "[moveFolder]")?.folder ?? null
}

/**
 * One request. The server deletes the folder and every subfolder under it, with no archive
 * step. The workflows in those folders stay: the database sets their `folder_id` to null.
 */
export const deleteFolder = async ({
    projectId,
    folderId,
}: {
    projectId: string
    folderId: string
}): Promise<void> => {
    await getFoldersClient().deleteFolder({folder_id: folderId}, projectScopedRequest(projectId))
}

/** Puts a prompt in a folder. Sends only the workflow id and the folder id. */
export const moveWorkflowToFolder = async ({
    projectId,
    workflowId,
    folderId,
}: {
    projectId: string
    workflowId: string
    folderId: string
}): Promise<void> => {
    await getWorkflowsClient().editWorkflow(
        {workflow_id: workflowId, workflow: {id: workflowId, folder_id: folderId}},
        projectScopedRequest(projectId),
    )
}

/** Renames a prompt and sets its description. A metadata edit: it commits no revision. */
export const renameWorkflow = async ({
    projectId,
    workflowId,
    name,
    description,
}: {
    projectId: string
    workflowId: string
    name: string
    description: string
}): Promise<void> => {
    await getWorkflowsClient().editWorkflow(
        {workflow_id: workflowId, workflow: {id: workflowId, name, description}},
        projectScopedRequest(projectId),
    )
}

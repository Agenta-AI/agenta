/**
 * Wire shapes of the `/folders` endpoints. Only the fields the screens read are listed.
 */
import {z} from "zod"

export const FOLDER_KIND_APPLICATIONS = "applications"

export const folderSchema = z.object({
    id: z.string(),
    name: z.string().nullish(),
    slug: z.string().nullish(),
    kind: z.string().nullish(),
    path: z.string().nullish(),
    parent_id: z.string().nullish(),
    created_at: z.string().nullish(),
    updated_at: z.string().nullish(),
})

export const foldersResponseSchema = z.object({
    count: z.number().nullish(),
    folders: z.array(folderSchema),
})

export const folderResponseSchema = z.object({
    count: z.number().nullish(),
    folder: folderSchema.nullish(),
})

export type Folder = z.infer<typeof folderSchema>

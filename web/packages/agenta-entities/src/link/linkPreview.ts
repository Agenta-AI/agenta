import {getLinksClient} from "@agenta/sdk/resources"
import {projectIdAtom} from "@agenta/shared/state"
import {atomFamily} from "jotai-family"
import {atomWithQuery} from "jotai-tanstack-query"
import {z} from "zod"

import {safeParseWithLogging} from "../shared"

export const linkPreviewSchema = z.object({
    url: z.string(),
    title: z.string().nullish(),
    description: z.string().nullish(),
    image: z.string().nullish(),
    site_name: z.string().nullish(),
    domain: z.string().nullish(),
})

export type LinkPreview = z.infer<typeof linkPreviewSchema>

const linkPreviewResponseSchema = z.object({
    count: z.number().optional(),
    preview: linkPreviewSchema.nullish(),
})

/** One page's preview, or null when the server refuses the link or the read fails. */
export async function fetchLinkPreview({
    url,
    projectId,
}: {
    url: string
    projectId: string
}): Promise<LinkPreview | null> {
    if (!url || !projectId) return null
    try {
        const data = await getLinksClient().previewLink(
            {url},
            {queryParams: {project_id: projectId}},
        )
        const parsed = safeParseWithLogging(linkPreviewResponseSchema, data, "[fetchLinkPreview]")
        return parsed?.preview ?? null
    } catch {
        return null
    }
}

/** A link's preview, fetched once per URL; "" fetches nothing. */
export const linkPreviewQueryFamily = atomFamily((url: string) =>
    atomWithQuery<LinkPreview | null>((get) => {
        const projectId = get(projectIdAtom) ?? ""
        return {
            queryKey: ["links", "preview", projectId, url],
            queryFn: () => fetchLinkPreview({url, projectId}),
            enabled: Boolean(url && projectId),
            staleTime: 60 * 60_000,
            gcTime: 60 * 60_000,
            retry: false,
            refetchOnWindowFocus: false,
        }
    }),
)

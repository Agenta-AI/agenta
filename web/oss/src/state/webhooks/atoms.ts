import {atomWithQuery} from "jotai-tanstack-query"

import {listWebhooks} from "@/oss/services/webhooks/api"
import {projectIdAtom} from "@/oss/state/project"

export const webhooksAtom = atomWithQuery((get) => {
    const projectId = get(projectIdAtom)

    return {
        queryKey: ["webhooks", projectId],
        queryFn: async () => {
            const response = await listWebhooks()
            return response.subscriptions
        },
        enabled: !!projectId,
    }
})

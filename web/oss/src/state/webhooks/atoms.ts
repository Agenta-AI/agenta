import {atom} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {fetchWebhooks} from "@/oss/services/webhooks/api"
import {selectedOrgAtom} from "@/oss/state/org"

export const webhooksAtom = atomWithQuery((get) => ({
    queryKey: ["webhooks", get(selectedOrgAtom)?.default_workspace?.id],
    queryFn: async () => {
        const workspaceId = get(selectedOrgAtom)?.default_workspace?.id
        if (!workspaceId) return []
        return fetchWebhooks(workspaceId)
    },
}))

export const isWebhooksLoadingAtom = atom((get) => {
    const webhooks = get(webhooksAtom)
    return webhooks.isPending
})

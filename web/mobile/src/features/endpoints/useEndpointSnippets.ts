import {useMemo} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    buildAppEndpointParams,
    buildFetchConfigSnippets,
    buildInvokeAppSnippets,
} from "@agenta/settings-ui"
import {useAtomValue} from "jotai"

import {getApiUrl} from "@/lib/env"

/**
 * The code to call one app in one environment, and to fetch its config. Only the selected
 * environment's deployed revision is read, so the page costs one revision request, not one per
 * environment.
 */
export const useEndpointSnippets = (
    appSlug: string | null,
    environment: AppEnvironmentDeployment | null,
) => {
    const revisionId = environment?.deployedRevisionId ?? ""
    // A disabled query reports pending forever, so ask only when there is a revision to load.
    const revision = useAtomValue(
        useMemo(() => workflowMolecule.atoms.query(revisionId), [revisionId]),
    )
    const url = useAtomValue(
        useMemo(() => workflowMolecule.selectors.deploymentUrl(revisionId), [revisionId]),
    )
    const inputSchema = useAtomValue(
        useMemo(() => workflowMolecule.selectors.inputSchema(revisionId), [revisionId]),
    )
    const isChat = useAtomValue(
        useMemo(() => workflowMolecule.selectors.isChat(revisionId), [revisionId]),
    )
    const environmentSlug = environment?.slug ?? "none"

    const snippets = useMemo(() => {
        const params = buildAppEndpointParams({inputSchema, environmentSlug, isChat, appSlug})
        return {
            invoke: buildInvokeAppSnippets({url: url?.trim() ?? "", params, isChat}),
            fetchConfig: buildFetchConfigSnippets({
                apiUrl: getApiUrl(),
                appSlug: appSlug ?? "",
                environmentSlug,
            }),
        }
    }, [inputSchema, environmentSlug, isChat, appSlug, url])

    return {
        ...snippets,
        isPending: Boolean(revisionId) && Boolean(revision.isPending),
        isError: Boolean(revisionId) && Boolean(revision.isError),
    }
}

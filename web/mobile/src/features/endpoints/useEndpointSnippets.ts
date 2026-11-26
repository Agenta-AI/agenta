import {useMemo} from "react"

import type {AppEnvironmentDeployment} from "@agenta/entities/environment"
import {workflowMolecule} from "@agenta/entities/workflow"
import {
    buildAppEndpointParams,
    buildFetchConfigSnippets,
    buildFetchVariantConfigSnippets,
    buildInvokeAppSnippets,
    type AppEndpointVariant,
} from "@agenta/settings-ui"
import {useAtomValue} from "jotai"

import {getApiUrl} from "@/lib/env"

/** What the snippets name: an environment, or one variant version. */
export type SnippetTarget = {environmentSlug: string} | {variant: AppEndpointVariant}

/**
 * The code to call one app revision and to fetch its config, for an environment or a variant
 * version. Only that revision is read, so this costs one revision request.
 */
export const useAppSnippets = ({
    appSlug,
    revisionId,
    target,
    apiKey,
}: {
    appSlug: string | null
    revisionId: string
    target: SnippetTarget
    apiKey?: string
}) => {
    // A disabled query reports pending forever, so ask only when there is a revision to load.
    const revision = useAtomValue(
        useMemo(() => workflowMolecule.atoms.query(revisionId), [revisionId]),
    )
    const url = useAtomValue(
        useMemo(() => workflowMolecule.selectors.deploymentUrl(revisionId), [revisionId]),
    )
    // The ports, not the input schema: a prompt app often declares no input schema, and its
    // inputs are the variables in its prompt templates.
    const inputs = useAtomValue(
        useMemo(() => workflowMolecule.selectors.inputPorts(revisionId), [revisionId]),
    )
    const isChat = useAtomValue(
        useMemo(() => workflowMolecule.selectors.isChat(revisionId), [revisionId]),
    )
    const variant = "variant" in target ? target.variant : undefined
    const environmentSlug = "environmentSlug" in target ? target.environmentSlug : "none"
    const variantSlug = variant?.slug
    const variantVersion = variant?.version

    const snippets = useMemo(() => {
        const named =
            variantSlug !== undefined && variantVersion !== undefined
                ? {slug: variantSlug, version: variantVersion}
                : undefined
        const params = buildAppEndpointParams({
            inputs,
            environmentSlug,
            isChat,
            appSlug,
            variant: named,
        })
        return {
            invoke: buildInvokeAppSnippets({url: url?.trim() ?? "", params, isChat, apiKey}),
            fetchConfig: named
                ? buildFetchVariantConfigSnippets({
                      apiUrl: getApiUrl(),
                      appSlug: appSlug ?? "",
                      variant: named,
                      apiKey,
                  })
                : buildFetchConfigSnippets({
                      apiUrl: getApiUrl(),
                      appSlug: appSlug ?? "",
                      environmentSlug,
                      apiKey,
                  }),
        }
    }, [apiKey, appSlug, environmentSlug, inputs, isChat, url, variantSlug, variantVersion])

    return {
        ...snippets,
        isPending: Boolean(revisionId) && Boolean(revision.isPending),
        isError: Boolean(revisionId) && Boolean(revision.isError),
    }
}

/** The Endpoints page: the code for the revision deployed to one environment. */
export const useEndpointSnippets = (
    appSlug: string | null,
    environment: AppEnvironmentDeployment | null,
) =>
    useAppSnippets({
        appSlug,
        revisionId: environment?.deployedRevisionId ?? "",
        target: {environmentSlug: environment?.slug ?? "none"},
    })

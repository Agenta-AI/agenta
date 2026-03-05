import {memo, useMemo} from "react"

import {
    deriveEnhancedCustomProperties,
    deriveEnhancedPrompts,
    fetchOssRevisionById,
    legacyAppRevisionMolecule,
} from "@agenta/entities/legacyAppRevision"
import {Spin} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import {atomWithQuery} from "jotai-tanstack-query"

import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import {playgroundEmbedResolutionViewModeAtom} from "@/oss/components/Playground/state/atoms"
import {
    moleculeBackedPromptsAtomFamily,
    moleculeBackedVariantAtomFamily,
} from "@/oss/state/newPlayground/legacyEntityBridge"
import {projectIdAtom} from "@/oss/state/project/selectors/project"

import PlaygroundVariantConfigPrompt from "../../PlaygroundVariantConfigPrompt"
import PlaygroundVariantCustomProperties from "../../PlaygroundVariantCustomProperties"

const PlaygroundVariantConfigEditors = ({
    variantId,
    className,
    ...divProps
}: {
    variantId: string
    className?: string
}) => {
    const resolutionMode = useAtomValue(playgroundEmbedResolutionViewModeAtom)
    const isResolvedView = resolutionMode === "resolved"
    const projectId = useAtomValue(projectIdAtom)

    const editableVariant = useAtomValue(moleculeBackedVariantAtomFamily(variantId)) as any
    const editablePrompts = (useAtomValue(moleculeBackedPromptsAtomFamily(variantId)) ||
        []) as any[]
    const revisionId = (editableVariant?.id as string | undefined) || variantId
    const resolvedQuery = useAtomValue(
        useMemo(
            () =>
                atomWithQuery<any | null>((get) => {
                    const mode = get(playgroundEmbedResolutionViewModeAtom)
                    const isResolved = mode === "resolved"
                    return {
                        queryKey: [
                            "playgroundResolvedRevisionView",
                            revisionId,
                            projectId,
                            mode,
                        ],
                        queryFn: () =>
                            projectId
                                ? fetchOssRevisionById(revisionId, projectId, {resolve: true})
                                : Promise.resolve(null),
                        enabled: isResolved && !!revisionId && !!projectId,
                        staleTime: 1000 * 60,
                        refetchOnWindowFocus: false,
                    }
                }),
            [revisionId, projectId],
        ),
    )
    const resolvedServerData = resolvedQuery?.data ?? null
    const resolvedSchema = useAtomValue(
        useMemo(() => legacyAppRevisionMolecule.atoms.agConfigSchema(variantId), [variantId]),
    )

    const resolvedParameters = resolvedServerData?.parameters as Record<string, unknown> | undefined
    const resolvedPrompts = useMemo(() => {
        if (!resolvedParameters || !resolvedSchema) return []
        return deriveEnhancedPrompts(resolvedSchema, resolvedParameters)
    }, [resolvedParameters, resolvedSchema])

    const resolvedCustomProps = useMemo(() => {
        if (!resolvedParameters || !resolvedSchema) return {}
        return deriveEnhancedCustomProperties(resolvedSchema, resolvedParameters)
    }, [resolvedParameters, resolvedSchema])

    const promptsForView = isResolvedView ? resolvedPrompts : editablePrompts
    const promptIds = useMemo(
        () =>
            (promptsForView || [])
                .map((prompt: any) => prompt?.__id as string)
                .filter((id: any): id is string => typeof id === "string" && id.length > 0),
        [promptsForView],
    )
    const variantExists = Boolean(
        isResolvedView ? resolvedServerData || editableVariant : editableVariant,
    )
    const promptsByRevision = useMemo(
        () => ({[variantId]: promptsForView}),
        [variantId, promptsForView],
    )

    if (!variantExists) {
        return (
            <div className="flex flex-col items-center justify-center py-6 gap-2">
                <Spin />
                <span className="text-xs text-gray-500">Loading variant configuration…</span>
                <span className="text-xs text-gray-500">variantId: {variantId}</span>
            </div>
        )
    }

    const disablePromptCollapse = promptIds.length === 1

    return (
        <PromptsSourceProvider
            promptsByRevision={promptsByRevision}
            preferProvided={isResolvedView}
        >
            <div className={clsx("flex flex-col", className)} {...divProps}>
                {promptIds.map((promptId) => (
                    <PlaygroundVariantConfigPrompt
                        key={`${variantId}:${promptId as string}`}
                        promptId={promptId}
                        variantId={variantId}
                        disableCollapse={disablePromptCollapse}
                        viewOnly={isResolvedView}
                    />
                ))}
                <PlaygroundVariantCustomProperties
                    variantId={variantId}
                    initialOpen={promptIds.length === 0}
                    viewOnly={isResolvedView}
                    customPropsRecord={isResolvedView ? (resolvedCustomProps as any) : undefined}
                />
            </div>
        </PromptsSourceProvider>
    )
}

export default memo(PlaygroundVariantConfigEditors)

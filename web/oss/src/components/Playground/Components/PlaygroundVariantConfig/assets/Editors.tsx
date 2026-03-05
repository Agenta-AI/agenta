import {memo, useCallback, useEffect, useMemo, useState} from "react"

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
    const resolvedQuery = useAtomValue(
        useMemo(
            () =>
                atomWithQuery<any | null>((get) => {
                    const mode = get(playgroundEmbedResolutionViewModeAtom)
                    const isResolved = mode === "resolved"
                    return {
                        queryKey: ["playgroundResolvedRevisionView", variantId, projectId],
                        queryFn: () =>
                            projectId
                                ? fetchOssRevisionById(variantId, projectId, {resolve: true})
                                : Promise.resolve(null),
                        enabled: isResolved && !!variantId && !!projectId,
                        staleTime: 1000 * 60,
                        refetchOnWindowFocus: false,
                    }
                }),
            [variantId, projectId],
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
    const editablePromptIds = useMemo(
        () =>
            (editablePrompts || [])
                .map((prompt: any) => prompt?.__id as string)
                .filter((id: any): id is string => typeof id === "string" && id.length > 0),
        [editablePrompts],
    )
    const promptIds = useMemo(
        () =>
            (promptsForView || [])
                .map((prompt: any) => prompt?.__id as string)
                .filter((id: any): id is string => typeof id === "string" && id.length > 0),
        [promptsForView],
    )
    const promptEntries = useMemo(
        () => promptIds.map((promptId, index) => ({promptId, index})),
        [promptIds],
    )
    const [promptPanelOpenByIndex, setPromptPanelOpenByIndex] = useState<Record<number, boolean>>({})
    useEffect(() => {
        if (promptEntries.length === 0) {
            setPromptPanelOpenByIndex({})
            return
        }

        setPromptPanelOpenByIndex((prev) => {
            const next: Record<number, boolean> = {}
            for (const {index} of promptEntries) {
                next[index] = prev[index] ?? true
            }
            return next
        })
    }, [promptEntries])
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

    // Keep layout defaults stable across resolved/unresolved modes.
    const promptCountForDefaults =
        editablePromptIds.length > 0 ? editablePromptIds.length : promptIds.length
    const disablePromptCollapse = promptCountForDefaults === 1
    const customPropsInitialOpen = promptCountForDefaults === 0
    const handlePromptCollapseChange = useCallback((index: number, activeKey: string | string[]) => {
        const nextOpen = Array.isArray(activeKey) ? activeKey.length > 0 : Boolean(activeKey)
        setPromptPanelOpenByIndex((prev) => ({...prev, [index]: nextOpen}))
    }, [])

    return (
        <PromptsSourceProvider
            promptsByRevision={promptsByRevision}
            preferProvided={isResolvedView}
        >
            <div className={clsx("flex flex-col", className)} {...divProps}>
                {promptEntries.map(({promptId, index}) => (
                    <PlaygroundVariantConfigPrompt
                        key={`${variantId}:prompt:${index}`}
                        promptId={promptId}
                        variantId={variantId}
                        disableCollapse={disablePromptCollapse}
                        viewOnly={isResolvedView}
                        activeKey={promptPanelOpenByIndex[index] === false ? [] : ["1"]}
                        onChange={(activeKey) => handlePromptCollapseChange(index, activeKey)}
                    />
                ))}
                <PlaygroundVariantCustomProperties
                    variantId={variantId}
                    initialOpen={customPropsInitialOpen}
                    viewOnly={isResolvedView}
                    customPropsRecord={isResolvedView ? (resolvedCustomProps as any) : undefined}
                />
            </div>
        </PromptsSourceProvider>
    )
}

export default memo(PlaygroundVariantConfigEditors)

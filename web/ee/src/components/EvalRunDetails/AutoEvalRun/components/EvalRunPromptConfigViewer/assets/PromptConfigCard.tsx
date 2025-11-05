import {memo, useEffect, useMemo, useRef, useState} from "react"

import {Empty, Skeleton, Tag, Typography} from "antd"
import clsx from "clsx"
import {atom, getDefaultStore, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {PromptsSourceProvider} from "@/oss/components/Playground/context/PromptsSource"
import {EnrichedEvaluationRun} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import type {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {fetchOpenApiSchemaJson} from "@/oss/lib/shared/variant/transformer"
import {
    deriveCustomPropertiesFromSpec,
    derivePromptsFromSpec,
} from "@/oss/lib/shared/variant/transformer/transformer"
import type {AgentaConfigPrompt} from "@/oss/lib/shared/variant/transformer/types"
import {projectScopedVariantsAtom} from "@/oss/state/projectVariantConfig"
import {
    appSchemaAtom,
    appUriInfoAtom,
    getEnhancedRevisionById,
} from "@/oss/state/variant/atoms/fetcher"

import EvalNameTag from "../../../assets/EvalNameTag"
import {EVAL_TAG_COLOR} from "../../../assets/utils"
import VariantTag from "../../../assets/VariantTag"
import {
    combineAppNameWithLabel,
    deriveVariantAppName,
    deriveVariantLabelParts,
    getVariantDisplayMetadata,
    normalizeId,
    prettifyVariantLabel,
} from "../../../assets/variantUtils"

import {PromptConfigCardSkeleton} from "./EvalRunPromptConfigViewerSkeleton"

const PlaygroundVariantConfigPrompt = dynamic(
    () => import("@/oss/components/Playground/Components/PlaygroundVariantConfigPrompt"),
    {ssr: false, loading: () => <PromptConfigCardSkeleton />},
)
const PlaygroundVariantCustomProperties = dynamic(
    () => import("@/oss/components/Playground/Components/PlaygroundVariantCustomProperties"),
    {ssr: false, loading: () => <PromptConfigCardSkeleton />},
)

type ParametersShape = Record<string, any> | null | undefined

type PromptNode = EnhancedObjectConfig<AgentaConfigPrompt>

const deriveFromParametersSnapshot = (parameters: ParametersShape) => {
    const ag = (parameters as any)?.ag_config ?? (parameters as any) ?? {}
    const fallbackPrompts = Object.entries(ag)
        .map(([name, cfg]: [string, any]) => {
            if (!cfg || typeof cfg !== "object") return null
            const messages = (cfg as any).messages
            const llm_config = (cfg as any).llm_config || (cfg as any).llmConfig
            if (!messages && !llm_config) return null
            return {
                __name: name,
                messages,
                llm_config,
            }
        })
        .filter(Boolean) as PromptNode[]

    return {prompts: fallbackPrompts, customProps: {}}
}

const mergeParametersWithSnapshot = (
    baseParameters: ParametersShape,
    snapshot: ParametersShape,
): ParametersShape => {
    if (!snapshot || typeof snapshot !== "object") {
        return baseParameters ?? undefined
    }

    const base = baseParameters && typeof baseParameters === "object" ? baseParameters : {}
    const merged: Record<string, any> = {
        ...base,
        ...snapshot,
    }

    const baseAgConfig =
        (base as any)?.ag_config ?? (base as any)?.agConfig ?? (base as any)?.parameters?.ag_config
    const snapshotAgConfig = (snapshot as any)?.ag_config ?? (snapshot as any)?.agConfig

    if (snapshotAgConfig && typeof snapshotAgConfig === "object") {
        const mergedAg = {
            ...(baseAgConfig && typeof baseAgConfig === "object" ? baseAgConfig : {}),
            ...snapshotAgConfig,
        }
        merged.ag_config = mergedAg
        merged.agConfig = mergedAg
    } else if (baseAgConfig && typeof baseAgConfig === "object") {
        merged.ag_config = baseAgConfig
        merged.agConfig = baseAgConfig
    }

    return merged
}

interface DeriveParams {
    variantId: string
    parameters: ParametersShape
}

// Single source atom family that derives prompts and custom props
const derivedPromptsAtomFamily = atomFamily(({variantId, parameters}: DeriveParams) =>
    atom((get) => {
        const normalizedVariantId = typeof variantId === "string" ? variantId.trim() : ""

        if (!normalizedVariantId) {
            return deriveFromParametersSnapshot(parameters)
        }

        const rev = getEnhancedRevisionById(get.bind(get) as any, normalizedVariantId)

        if (rev) {
            try {
                const spec = get(appSchemaAtom)
                const routePath = get(appUriInfoAtom)?.routePath

                if (spec) {
                    const mergedParameters = mergeParametersWithSnapshot(
                        (rev as any).parameters,
                        parameters,
                    )
                    const mergedVariant = {
                        ...(rev as any),
                        parameters: mergedParameters ?? (rev as any).parameters,
                    }

                    const derivedPrompts = derivePromptsFromSpec(
                        mergedVariant as any,
                        spec as any,
                        routePath,
                    ) as PromptNode[]
                    const derivedCustomProps = deriveCustomPropertiesFromSpec(
                        mergedVariant as any,
                        spec as any,
                        routePath,
                    ) as Record<string, any>

                    if (Array.isArray(derivedPrompts)) {
                        return {prompts: derivedPrompts, customProps: derivedCustomProps}
                    }
                }
            } catch (error) {
                if (process.env.NODE_ENV !== "production") {
                    console.warn("[PromptConfig] Failed to derive prompts from spec", error)
                }
            }
        }

        return deriveFromParametersSnapshot(parameters)
    }),
)

const PromptContentSkeleton = memo(({description}: {description: string}) => {
    return (
        <div className="flex flex-col gap-4 px-4 py-4">
            <Skeleton.Input active style={{width: "100%", height: 120}} />
            <Skeleton.Input active style={{width: "100%", height: 120}} />
            <div className="flex justify-center py-2">
                <Typography.Text type="secondary">{description}</Typography.Text>
            </div>
        </div>
    )
})

const PromptConfigCard = ({
    variantId,
    evaluation,
    isComparison,
    colorIndex,
    isFirstPrompt,
    isMiddlePrompt,
    isLastPrompt,
    totalRuns,
}: {
    variantId: string
    evaluation: EnrichedEvaluationRun
    isComparison: boolean
    colorIndex: number
    isFirstPrompt: boolean
    isMiddlePrompt: boolean
    isLastPrompt: boolean
    totalRuns: number
}) => {
    const router = useRouter()
    const normalizedVariantId = useMemo(() => (variantId ? String(variantId) : ""), [variantId])
    const jotaiStore = useMemo(() => getDefaultStore(), [])
    const projectScopedVariants = useAtomValue(projectScopedVariantsAtom)

    const [fallbackPrompts, setFallbackPrompts] = useState<PromptNode[]>([])
    const [fallbackCustomProps, setFallbackCustomProps] = useState<Record<string, any>>({})
    const [fallbackTrigger, setFallbackTrigger] = useState(0)
    const fallbackAttemptsRef = useRef(0)

    const variants = evaluation?.variants ?? []
    const selectedVariant = useMemo(() => {
        if (!variants.length) return undefined
        if (!normalizedVariantId) return variants[0]

        return (
            variants.find((variant) => {
                const candidateIds = [
                    (variant as any)?._revisionId,
                    (variant as any)?.id,
                    variant?.variantId,
                ]
                return candidateIds.some(
                    (candidate) =>
                        candidate !== undefined && String(candidate) === normalizedVariantId,
                )
            }) || undefined
        )
    }, [variants, normalizedVariantId])

    const projectScopedVariant = useMemo(() => {
        if (!normalizedVariantId) return undefined
        const scoped = projectScopedVariants?.revisionMap?.[normalizedVariantId]
        return scoped && scoped.length > 0 ? scoped[0] : undefined
    }, [normalizedVariantId, projectScopedVariants])

    useEffect(() => {
        setFallbackPrompts([])
        setFallbackCustomProps({})
        fallbackAttemptsRef.current = 0
        setFallbackTrigger(0)
    }, [normalizedVariantId])

    const variantForDisplay = selectedVariant ?? projectScopedVariant

    const fallbackVariantSource = useMemo(() => {
        if (projectScopedVariant?.uri) return projectScopedVariant
        if (selectedVariant?.uri) return selectedVariant
        return projectScopedVariant ?? selectedVariant ?? null
    }, [projectScopedVariant, selectedVariant])

    const variantDisplay = useMemo(
        () =>
            getVariantDisplayMetadata(variantForDisplay, {
                fallbackLabel: normalizedVariantId || undefined,
                fallbackRevisionId: normalizedVariantId || undefined,
                requireRuntime: false,
            }),
        [variantForDisplay, normalizedVariantId],
    )

    const {label: formattedVariantLabel} = useMemo(
        () =>
            deriveVariantLabelParts({
                variant: variantForDisplay,
                displayLabel: variantDisplay.label,
            }),
        [variantForDisplay, variantDisplay.label],
    )

    const variantAppName = useMemo(
        () =>
            deriveVariantAppName({
                variant: variantForDisplay,
                fallbackAppName:
                    (evaluation as any)?.appName ??
                    (evaluation as any)?.app_name ??
                    (evaluation as any)?.app?.name ??
                    undefined,
            }),
        [variantForDisplay, evaluation],
    )

    const variantLabel = combineAppNameWithLabel(
        variantAppName,
        prettifyVariantLabel(formattedVariantLabel) ?? formattedVariantLabel,
    )

    const revisionId = variantDisplay.revisionId || normalizedVariantId || ""

    const variantAppId = useMemo(
        () =>
            normalizeId(
                (variantForDisplay as any)?.appId ??
                    (variantForDisplay as any)?.app_id ??
                    (variantForDisplay as any)?.application?.id ??
                    (variantForDisplay as any)?.application_id ??
                    (variantForDisplay as any)?.application_ref?.id ??
                    (variantForDisplay as any)?.applicationRef?.id,
            ),
        [variantForDisplay],
    )

    const evaluationAppId = useMemo(
        () =>
            normalizeId(
                (evaluation as any)?.appId ??
                    (evaluation as any)?.app_id ??
                    (evaluation as any)?.app?.id ??
                    (evaluation as any)?.application?.id,
            ),
        [evaluation],
    )

    const normalizedRouteAppId = useMemo(
        () => normalizeId(router.query?.app_id as string | undefined),
        [router.query?.app_id],
    )

    const navigableAppId = variantAppId || evaluationAppId || normalizedRouteAppId
    const isRouteAppContext =
        Boolean(normalizedRouteAppId) && navigableAppId === normalizedRouteAppId
    const blockedByRuntime = isRouteAppContext && variantDisplay.hasRuntime === false

    const canNavigateToVariant = Boolean(
        revisionId && navigableAppId && variantDisplay.isHealthy !== false && !blockedByRuntime,
    )

    const parameters = useMemo(() => {
        const map = (evaluation as any)?.parametersByRevisionId as
            | Record<string, ParametersShape>
            | undefined

        if (map) {
            const candidateIds = [
                normalizedVariantId,
                String((selectedVariant as any)?._revisionId ?? ""),
                String((selectedVariant as any)?.id ?? ""),
                String(selectedVariant?.variantId ?? ""),
            ].filter(
                (id) =>
                    !!id &&
                    id !== "undefined" &&
                    id !== "null" &&
                    id !== "[object Object]" &&
                    id !== "NaN",
            )

            for (const id of candidateIds) {
                if (map[id]) {
                    return map[id]
                }
            }
        }

        const projectScopedParams = (projectScopedVariant as any)?.configParams

        return (
            (selectedVariant as any)?.parameters ??
            (selectedVariant as any)?.configParams ??
            projectScopedParams ??
            undefined
        )
    }, [evaluation, normalizedVariantId, selectedVariant, projectScopedVariant])

    const deriveParams = useMemo(
        () => ({variantId: normalizedVariantId, parameters}),
        [normalizedVariantId, parameters],
    )

    const {prompts, customProps} = useAtomValue(derivedPromptsAtomFamily(deriveParams), {
        store: jotaiStore,
    })

    const basePrompts = prompts ?? []
    const promptsList = basePrompts.length ? basePrompts : fallbackPrompts

    const combinedCustomProps = useMemo(() => {
        if (customProps && Object.keys(customProps).length > 0) return customProps
        return fallbackCustomProps
    }, [customProps, fallbackCustomProps])

    const baseCustomPropsHasContent = useMemo(() => {
        if (!customProps) return false
        return Object.values(customProps).some((value) => {
            if (value === null || value === undefined) return false
            if (Array.isArray(value)) return value.length > 0
            if (typeof value === "object") return Object.keys(value).length > 0
            if (typeof value === "string") return value.trim().length > 0
            return true
        })
    }, [customProps])

    const combinedCustomPropsHasContent = useMemo(() => {
        if (!combinedCustomProps) return false
        return Object.values(combinedCustomProps).some((value) => {
            if (value === null || value === undefined) return false
            if (Array.isArray(value)) return value.length > 0
            if (typeof value === "object") return Object.keys(value).length > 0
            if (typeof value === "string") return value.trim().length > 0
            return true
        })
    }, [combinedCustomProps])

    const hasPrompts = promptsList.length > 0
    const hasContent = hasPrompts || combinedCustomPropsHasContent
    const hasVariantsInRun =
        (evaluation?.variants?.length ?? 0) > 0 || Boolean(projectScopedVariant)
    const isVariantSelectable = Boolean(normalizedVariantId && variantForDisplay)
    const showSkeleton = Boolean(
        !variantForDisplay && normalizedVariantId && hasVariantsInRun && !parameters,
    )
    const showPrompts = isVariantSelectable && hasContent
    const emptyDescription = !isVariantSelectable
        ? "Prompt configuration is unavailable because the source application or variant is no longer accessible."
        : hasContent
          ? "Prompt configuration isn't available because the original application is no longer accessible."
          : "This evaluation does not include any prompt configuration data."

    const promptsMap = useMemo(() => {
        if (!normalizedVariantId) return {}
        return {[normalizedVariantId]: promptsList as PromptNode[] | undefined}
    }, [normalizedVariantId, promptsList])

    const fallbackCustomPropsPopulated = useMemo(
        () => Object.keys(fallbackCustomProps).length > 0,
        [fallbackCustomProps],
    )

    const shouldAttemptFallback = useMemo(() => {
        if (!normalizedVariantId) return false
        if (!fallbackVariantSource?.uri) return false
        if (basePrompts.length > 0 || baseCustomPropsHasContent) return false
        if (fallbackPrompts.length > 0 || fallbackCustomPropsPopulated) return false
        return true
    }, [
        normalizedVariantId,
        fallbackVariantSource,
        basePrompts.length,
        baseCustomPropsHasContent,
        fallbackPrompts.length,
        fallbackCustomPropsPopulated,
    ])

    useEffect(() => {
        if (!shouldAttemptFallback) return

        let isCancelled = false
        let retryTimeout: ReturnType<typeof setTimeout> | undefined

        const snapshot =
            (parameters && Object.keys(parameters as any).length > 0
                ? parameters
                : (fallbackVariantSource as any)?.configParams) ?? {}

        const run = async () => {
            try {
                const {schema} = await fetchOpenApiSchemaJson(fallbackVariantSource!.uri as string)
                if (!schema) {
                    throw new Error("Missing OpenAPI schema")
                }

                const mergedParameters = mergeParametersWithSnapshot(
                    (fallbackVariantSource as any)?.parameters,
                    snapshot,
                )

                const fallbackVariant = {
                    ...fallbackVariantSource,
                    parameters: mergedParameters ?? snapshot,
                }

                const derivedPrompts = derivePromptsFromSpec(
                    fallbackVariant as any,
                    schema as any,
                ) as PromptNode[]
                const derivedCustomProps = deriveCustomPropertiesFromSpec(
                    fallbackVariant as any,
                    schema as any,
                ) as Record<string, any>

                if (isCancelled) return

                fallbackAttemptsRef.current = 0
                setFallbackPrompts(Array.isArray(derivedPrompts) ? derivedPrompts : [])
                setFallbackCustomProps(derivedCustomProps ?? {})

                if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
                    console.info("[PromptConfigCard] Fallback prompts derived", {
                        runId: evaluation?.id,
                        variantId: normalizedVariantId,
                        promptCount: derivedPrompts?.length ?? 0,
                        customPropsCount: Object.keys(derivedCustomProps ?? {}).length,
                    })
                }
            } catch (error: any) {
                if (isCancelled) return
                const attempt = fallbackAttemptsRef.current + 1
                fallbackAttemptsRef.current = attempt
                if (attempt <= 3) {
                    if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
                        console.warn("[PromptConfigCard] Fallback prompt fetch failed, retrying", {
                            runId: evaluation?.id,
                            variantId: normalizedVariantId,
                            attempt,
                            error,
                        })
                    }
                    retryTimeout = setTimeout(() => {
                        setFallbackTrigger((prev) => prev + 1)
                    }, 500 * attempt)
                } else if (process.env.NODE_ENV !== "production" && typeof window !== "undefined") {
                    console.error("[PromptConfigCard] Fallback prompt fetch failed", {
                        runId: evaluation?.id,
                        variantId: normalizedVariantId,
                        attempt,
                        error,
                    })
                }
            }
        }

        run()

        return () => {
            isCancelled = true
            if (retryTimeout) clearTimeout(retryTimeout)
        }
    }, [
        shouldAttemptFallback,
        fallbackTrigger,
        normalizedVariantId,
        fallbackVariantSource,
        evaluation?.id,
        parameters,
    ])

    const usingFallbackPrompts = basePrompts.length === 0 && fallbackPrompts.length > 0
    const usingFallbackCustomProps = !baseCustomPropsHasContent && fallbackCustomPropsPopulated
    const parametersSource =
        usingFallbackPrompts || usingFallbackCustomProps
            ? "project-fallback"
            : selectedVariant
              ? "run"
              : projectScopedVariant
                ? "project-scoped"
                : "none"

    return (
        <div
            className={clsx([
                "flex flex-col border border-solid border-[#0517290F] w-full rounded h-fit",
                {"!w-[500px] 2xl:!w-fit shrink-0": isComparison && totalRuns > 2},
                {"!rounded-r-none": isComparison && isFirstPrompt},
                {"!rounded-none": isComparison && isMiddlePrompt},
                {"!rounded-l-none": isComparison && isLastPrompt},
            ])}
        >
            <div className="h-[48px] flex items-center justify-between py-2 px-2 border-0 border-b border-solid border-[#EAEFF5]">
                <div className="w-[80%] flex items-center gap-2">
                    <EvalNameTag
                        color={EVAL_TAG_COLOR?.[colorIndex || 1]}
                        run={evaluation}
                        className={isComparison ? "!max-w-[60%]" : ""}
                        allowVariantNavigation={canNavigateToVariant}
                    />
                    {variantForDisplay ? (
                        <VariantTag
                            variantName={variantLabel}
                            revision={(variantForDisplay as any)?.revision}
                            id={revisionId || undefined}
                            disabled={!canNavigateToVariant}
                            enrichedRun={evaluation}
                            variant={variantForDisplay}
                            className="[&_span]:truncate [&_span]:max-w-[150px]"
                        />
                    ) : (
                        <Tag bordered={false} className="bg-[#0517290F] text-[#1C2C3D]">
                            Variant unavailable
                        </Tag>
                    )}
                </div>
            </div>

            {showSkeleton ? (
                <PromptContentSkeleton description="Loading prompt configuration…" />
            ) : showPrompts ? (
                <PromptsSourceProvider promptsByRevision={promptsMap}>
                    <div className="flex flex-col w-full">
                        {promptsList.map((prompt) => (
                            <PlaygroundVariantConfigPrompt
                                key={`${normalizedVariantId}:${prompt.__id || prompt.__name}`}
                                variantId={normalizedVariantId}
                                promptId={String(prompt.__id || prompt.__name)}
                                viewOnly
                            />
                        ))}
                        <PlaygroundVariantCustomProperties
                            variantId={normalizedVariantId}
                            initialOpen
                            viewOnly
                            customPropsRecord={combinedCustomProps}
                        />
                    </div>
                </PromptsSourceProvider>
            ) : (
                <div className="flex items-center justify-center py-8 px-4">
                    <Empty
                        description={
                            <Typography.Text type="secondary" className="text-center">
                                {emptyDescription}
                            </Typography.Text>
                        }
                        image={Empty.PRESENTED_IMAGE_SIMPLE}
                    />
                </div>
            )}
        </div>
    )
}

export default memo(PromptConfigCard)

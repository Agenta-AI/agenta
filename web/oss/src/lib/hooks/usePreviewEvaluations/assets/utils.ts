import {useCallback, useMemo} from "react"

import {getDefaultStore} from "jotai"

import {getMetricsFromEvaluator} from "@/oss/components/pages/observability/drawer/AnnotateDrawer/assets/transforms"
import {useAppId} from "@/oss/hooks/useAppId"
import {formatDay} from "@/oss/lib/helpers/dateTimeHelper"
import dayjs from "@/oss/lib/helpers/dateTimeHelper/dayjs"
import {RunIndex, StepMeta} from "@/oss/lib/hooks/useEvaluationRunData/assets/helpers/buildRunIndex"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorDto} from "@/oss/lib/hooks/useEvaluators/types"
import {
    EnrichedEvaluationRun,
    EvaluationRun,
    IEvaluationRunDataStep,
} from "@/oss/lib/hooks/usePreviewEvaluations/types"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import {EnhancedObjectConfig} from "@/oss/lib/shared/variant/genericTransformer/types"
import {AgentaConfigPrompt, EnhancedVariant} from "@/oss/lib/shared/variant/transformer/types"
import {WorkspaceMember, SnakeToCamelCaseKeys, PreviewTestset} from "@/oss/lib/Types"
import {useAppList} from "@/oss/state/app/hooks"
import {transformedPromptsAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {useOrgData} from "@/oss/state/org"
// import {getProjectValues} from "@/oss/state/project"

const pickString = (...values: unknown[]): string | undefined => {
    for (const value of values) {
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        if (!trimmed) continue
        return trimmed
    }
    return undefined
}

const deriveInvocationMetadata = (runIndex?: RunIndex) => {
    if (!runIndex) return null
    const [firstInvocationKey] = Array.from(runIndex.invocationKeys)
    if (!firstInvocationKey) return null
    const meta = runIndex.steps[firstInvocationKey]
    if (!meta) return null
    const refs = meta.refs ?? {}

    const applicationRevision =
        refs.applicationRevision || refs.application_revision || refs.revision
    const applicationRef =
        refs.application ||
        applicationRevision?.application ||
        refs.applicationRef ||
        refs.application_ref
    const variantRef =
        refs.variant ||
        refs.variantRef ||
        refs.variant_ref ||
        refs.applicationVariant ||
        refs.application_variant

    const appId = pickString(
        applicationRef?.id,
        applicationRef?.app_id,
        applicationRef?.appId,
        applicationRevision?.application_id,
        applicationRevision?.applicationId,
        refs.application?.id,
        refs.application?.app_id,
        refs.application?.appId,
    )

    const appName = pickString(
        applicationRef?.name,
        applicationRef?.slug,
        refs.application?.name,
        refs.application?.slug,
    )

    const variantName = pickString(
        variantRef?.name,
        variantRef?.slug,
        variantRef?.variantName,
        variantRef?.variant_name,
        applicationRef?.name,
        applicationRef?.slug,
        refs.application?.name,
        refs.application?.slug,
        meta.key,
    )

    const revisionId = pickString(
        variantRef?.id,
        variantRef?.revisionId,
        variantRef?.revision_id,
        applicationRevision?.id,
        applicationRevision?.revisionId,
        applicationRevision?.revision_id,
    )

    const revisionLabel =
        pickString(
            variantRef?.version,
            variantRef?.revision,
            variantRef?.revisionLabel,
            applicationRevision?.revision,
            applicationRevision?.version,
            applicationRevision?.name,
        ) ?? null

    return {
        appId,
        appName,
        variantName,
        revisionId,
        revisionLabel: revisionLabel ?? undefined,
    }
}

export const enrichEvaluationRun = ({
    run: _run,
    testsets,
    variantsData,
    evaluators,
    members,
    runIndex,
    extras,
    appNameById: _appNameById,
    projectScope = false,
}: {
    run: SnakeToCamelCaseKeys<EvaluationRun>
    testsets: PreviewTestset[]
    variantsData: any
    evaluators: EvaluatorDto[]
    members: WorkspaceMember[]
    runIndex?: RunIndex
    extras?: {
        parametersByRevisionId?: Record<string, any>
        flagsByRevisionId?: Record<string, any>
        variantConfigs?: Record<string, any>
    }
    appNameById?: Map<string, string>
    projectScope?: boolean
}) => {
    const run: Partial<EnrichedEvaluationRun> = _run
    const appNameById = _appNameById ?? new Map<string, string>()
    // Robust createdAt handling: accept known format or ISO/date-like fallback
    const parsedTs = dayjs(run.createdAt, "YYYY/MM/DD H:mm:ssAZ", true).valueOf()
    const fallbackTs = Number.isNaN(parsedTs) ? dayjs(run.createdAt as any).valueOf() : parsedTs
    run.createdAtTimestamp = Number.isNaN(fallbackTs) ? Date.now() : fallbackTs
    // Format creation date for display
    run.createdAt = formatDay({
        date: dayjs(run.createdAtTimestamp).toISOString(),
        outputFormat: "DD MMM YYYY | h:mm a",
    })
    // Derive potential ids via runIndex – allow multiple
    const testsetIds: string[] = []
    const revisionIds: string[] = []

    if (runIndex) {
        for (const meta of Object.values(runIndex.steps) as StepMeta[]) {
            if (meta.refs?.testset) {
                testsetIds.push(meta.refs.testset.id)
            }
            if (meta.refs?.applicationRevision) {
                revisionIds.push(meta.refs.applicationRevision.id)
            }
        }
    }

    const uniqueTestsetIds = Array.from(new Set(testsetIds))
    const uniqueRevisionIds = Array.from(new Set(revisionIds))

    // Resolve testset objects
    const resolvedTestsets = testsets
        ? (uniqueTestsetIds
              .flatMap((id) =>
                  testsets
                      ?.filter((ts) => ts.id === id)
                      .map((ts) => ({
                          ...ts,
                          name: ts.name,
                          createdAt: ts.created_at,
                          createdAtTimestamp: dayjs(
                              ts.created_at,
                              "YYYY/MM/DD H:mm:ssAZ",
                          ).valueOf(),
                      })),
              )
              .filter(Boolean) as PreviewTestset[])
        : []

    // Support both shapes: array or { variants: [...] }
    const variantList: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>[] = Array.isArray(
        variantsData,
    )
        ? variantsData
        : (variantsData?.variants as EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>[]) ||
          []

    const configVariants: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>[] =
        extras?.variantConfigs
            ? Object.entries(extras.variantConfigs)
                  .map(([key, config]) => {
                      if (!config) return null
                      const variantRef = config.variant_ref || {}
                      const applicationRef = config.application_ref || {}
                      const id = variantRef.id || key
                      if (!id) return null
                      return {
                          id,
                          variantId: variantRef.id || id,
                          variantName:
                              variantRef.slug ||
                              variantRef.id ||
                              variantRef.name ||
                              config?.service_ref?.slug ||
                              key,
                          name:
                              variantRef.slug ||
                              variantRef.id ||
                              variantRef.name ||
                              config?.service_ref?.slug ||
                              key,
                          configName: variantRef.slug || variantRef.name,
                          appId: applicationRef?.id,
                          appSlug: applicationRef?.slug,
                          appStatus: undefined,
                          uri: config.url,
                          revision: variantRef.version ?? null,
                          revisionLabel: variantRef.version ?? null,
                          createdAtTimestamp: run.createdAtTimestamp,
                          createdAt: run.createdAt,
                          configParams: config.params,
                      } as any
                  })
                  .filter(Boolean)
            : []

    const variantMap = new Map<string, any>()
    variantList.forEach((variant: any) => {
        if (!variant?.id) return
        variantMap.set(String(variant.id), variant)
    })
    configVariants.forEach((variant: any) => {
        if (!variant?.id) return
        const key = String(variant.id)
        if (!variantMap.has(key)) {
            variantMap.set(key, variant)
            return
        }
        const existing = variantMap.get(key)
        variantMap.set(key, {
            ...existing,
            ...variant,
            variantName: variant.variantName || existing?.variantName,
            configName: variant.configName || existing?.configName,
            name: variant.name || existing?.name,
        })
    })
    const combinedVariantList: EnhancedVariant<EnhancedObjectConfig<AgentaConfigPrompt>>[] =
        Array.from(variantMap.values())

    const filteredVariants = combinedVariantList.filter((v) => uniqueRevisionIds.includes(v.id))

    const invocationMetadata = deriveInvocationMetadata(runIndex)

    const fallbackVariants =
        filteredVariants.length || !runIndex
            ? []
            : Array.from(runIndex.invocationKeys)
                  .map((key) => {
                      const meta = runIndex.steps[key]
                      if (!meta) return null
                      const refs = meta.refs || {}
                      const application =
                          refs.application || refs.applicationRevision?.application || {}
                      const revision = refs.applicationRevision || {}

                      const appId =
                          application?.id ||
                          application?.app_id ||
                          application?.application_id ||
                          revision?.application_id ||
                          undefined

                      const variantName =
                          application?.name || application?.slug || refs.variant?.name || meta.key

                      const revisionId =
                          revision?.id || revision?.revision_id || revision?.revisionId || meta.key

                      const revisionLabel =
                          revision?.name || revision?.revision || revision?.version || undefined

                      return {
                          id: revisionId,
                          variantId: revisionId,
                          appId,
                          appName: application?.name,
                          variantName,
                          revision: revisionLabel,
                          revisionLabel,
                          createdAt: run.createdAt,
                          createdAtTimestamp: run.createdAtTimestamp,
                      }
                  })
                  .filter((item): item is Record<string, any> => Boolean(item))

    // Note: projectId not needed for enrichment; kept resolvers local to run data

    const baseVariants = filteredVariants.length ? filteredVariants : []
    const combinedVariants = (
        baseVariants.length ? baseVariants : fallbackVariants
    ) as typeof fallbackVariants

    const normalizedVariants = combinedVariants
        .map((variant) => {
            const fallbackId =
                variant.id || variant.variantId || (variant as any).revisionId || undefined
            if (fallbackId && variant.id !== fallbackId) {
                return {
                    ...variant,
                    id: fallbackId,
                    variantId: variant.variantId || fallbackId,
                }
            }
            return variant.id
                ? variant
                : {
                      ...variant,
                      variantId: variant.variantId || fallbackId,
                      id: fallbackId,
                  }
        })
        .filter((variant) => Boolean(variant.id))

    const originalVariants = Array.isArray((run as any)?.variants)
        ? ((run as any)?.variants as any[])
        : []
    const originalPrimaryVariant = originalVariants.length ? originalVariants[0] : undefined

    const invocationAppId =
        typeof invocationMetadata?.appId === "string" && invocationMetadata.appId
            ? invocationMetadata.appId
            : undefined
    const invocationAppName =
        invocationAppId && invocationMetadata?.appName ? invocationMetadata.appName : undefined

    const runAppId =
        typeof (run as any)?.appId === "string" && (run as any).appId.trim()
            ? (run as any).appId.trim()
            : undefined
    const runAppName =
        typeof (run as any)?.appName === "string" && (run as any).appName.trim()
            ? (run as any).appName.trim()
            : undefined

    const originalVariantAppIds = originalVariants
        .map(
            (variant: any) =>
                (typeof variant?.appId === "string" && variant.appId.trim()) ||
                (typeof variant?.app_id === "string" && variant.app_id.trim()) ||
                undefined,
        )
        .filter((value): value is string => Boolean(value))

    const normalizedVariantAppIds = normalizedVariants
        .map(
            (variant: any) =>
                (typeof variant?.appId === "string" && variant.appId.trim()) ||
                (typeof variant?.applicationId === "string" && variant.applicationId.trim()) ||
                undefined,
        )
        .filter((value): value is string => Boolean(value))

    const finalAppId = pickString(
        invocationAppId,
        runAppId,
        ...originalVariantAppIds,
        ...normalizedVariantAppIds,
    )

    const variantForFinalApp =
        finalAppId &&
        (normalizedVariants.find((variant: any) => variant?.appId === finalAppId) ||
            originalVariants.find(
                (variant: any) => variant?.appId === finalAppId || variant?.app_id === finalAppId,
            ))

    const finalAppName = pickString(
        invocationAppId && invocationAppId === finalAppId ? invocationAppName : undefined,
        finalAppId ? appNameById.get(finalAppId) : undefined,
        runAppId && runAppId === finalAppId ? runAppName : undefined,
        variantForFinalApp?.appName,
        variantForFinalApp?.appSlug,
        originalPrimaryVariant?.variantName,
        invocationMetadata?.variantName,
        runAppName,
        ((run as any)?.name as string) || undefined,
    )

    const returnValue = {
        ...run,
        appId: finalAppId,
        appName: finalAppName,
        variants: normalizedVariants,
        testsets: resolvedTestsets,
        createdBy: members.find((member) => member.user.id === run.createdById),
        parametersByRevisionId: extras?.parametersByRevisionId || {},
        flagsByRevisionId: extras?.flagsByRevisionId || {},
    }

    normalizedVariants.forEach((variant: any) => {
        const revisionKey = variant.id || variant.variantId
        if (!revisionKey) return
        if (variant.configParams) {
            returnValue.parametersByRevisionId[revisionKey] =
                returnValue.parametersByRevisionId[revisionKey] || variant.configParams
        }
        if (!returnValue.appId && variant.appId) {
            returnValue.appId = variant.appId
        }
        if (
            !returnValue.appName &&
            variant.appName &&
            (!returnValue.appId || variant.appId === returnValue.appId)
        ) {
            returnValue.appName = variant.appName
        }
    })
    if (!returnValue.appName && returnValue.appId) {
        const mappedName = appNameById.get(returnValue.appId)
        if (mappedName) {
            returnValue.appName = mappedName
        }
    }
    if (runIndex) {
        // Find all annotation steps via index if available
        const annotationSteps = Array.from(runIndex.annotationKeys)
            .map((k) => {
                // locate original step for richer data
                return (run.data?.steps || []).find((s) => s.key === k) as
                    | IEvaluationRunDataStep
                    | undefined
            })
            .filter(Boolean)

        const evaluatorRefs = new Set<string>()
        annotationSteps.forEach((step) => {
            const ref = step?.references?.evaluator
            if (!ref) return
            if (ref.id) evaluatorRefs.add(ref.id)
            if (ref.slug) evaluatorRefs.add(ref.slug)
            if (ref.key) evaluatorRefs.add(ref.key)
        })

        const matchedEvaluators: EvaluatorDto[] = []
        const seenIds = new Set<string>()
        const seenSlugs = new Set<string>()
        const seenKeys = new Set<string>()

        Array.from(evaluatorRefs).forEach((reference) => {
            const match = evaluators?.find(
                (e) => e.id === reference || e.slug === reference || e.key === reference,
            )
            if (!match) return

            const normalizedMatch = {
                ...match,
                metrics:
                    (match as any).metrics && Object.keys((match as any).metrics || {}).length > 0
                        ? (match as any).metrics
                        : getMetricsFromEvaluator(match as EvaluatorDto),
            }

            const id = typeof normalizedMatch.id === "string" ? normalizedMatch.id : undefined
            const slug = typeof normalizedMatch.slug === "string" ? normalizedMatch.slug : undefined
            const key = typeof normalizedMatch.key === "string" ? normalizedMatch.key : undefined
            const fallbackKey = reference

            if (id && seenIds.has(id)) return
            if (!id && slug && seenSlugs.has(slug)) return
            if (!id && !slug && key && seenKeys.has(key)) return
            if (!id && !slug && !key && seenKeys.has(fallbackKey)) return

            if (id) seenIds.add(id)
            if (slug) seenSlugs.add(slug)
            if (key) {
                seenKeys.add(key)
            } else if (!id && !slug) {
                seenKeys.add(fallbackKey)
            }

            matchedEvaluators.push(normalizedMatch as EvaluatorDto)
        })

        returnValue.evaluators = matchedEvaluators
    }

    return returnValue as EnrichedEvaluationRun
}

const useEnrichEvaluationRun = ({
    evalType = "human",
}: {
    evalType?: "human" | "auto" | "online" | "custom"
} = {}):
    | ((
          run: SnakeToCamelCaseKeys<EvaluationRun>,
          testsetData?: PreviewTestset[],
          runIndex?: RunIndex,
      ) => EnrichedEvaluationRun)
    | undefined => {
    const {selectedOrg} = useOrgData()
    const members = selectedOrg?.default_workspace?.members || []
    const routeAppId = useAppId()
    const isProjectScope = !routeAppId
    const appList = useAppList()
    const appNames = useMemo(() => {
        return new Map((appList || []).map((item) => [item.app_id, item.app_name]))
    }, [appList])

    const {data: evaluators, isLoading: loadingEvaluators} = useEvaluators({
        preview: true,
        queries:
            evalType === "human"
                ? {is_human: true}
                : evalType === "custom"
                  ? {is_evaluator: true}
                  : {},
    })

    const combinedEvaluators = useMemo(() => {
        const list: EvaluatorDto[] = []
        const seenIds = new Set<string>()
        const seenSlugs = new Set<string>()
        const seenKeys = new Set<string>()

        const pushEvaluator = (ev: any) => {
            if (!ev) return
            const id = typeof ev.id === "string" ? ev.id : undefined
            const slug = typeof ev.slug === "string" ? ev.slug : undefined
            const key = typeof ev.key === "string" ? ev.key : undefined
            if (id && seenIds.has(id)) return
            if (!id && slug && seenSlugs.has(slug)) return
            if (!id && !slug && key && seenKeys.has(key)) return
            if (id) seenIds.add(id)
            if (slug) seenSlugs.add(slug)
            if (!id && !slug && key) seenKeys.add(key)
            const metrics =
                (ev as any)?.metrics && Object.keys((ev as any).metrics || {}).length > 0
                    ? (ev as any).metrics
                    : getMetricsFromEvaluator(ev as EvaluatorDto)
            list.push({...ev, metrics} as EvaluatorDto)
        }
        ;(Array.isArray(evaluators) ? evaluators : []).forEach(pushEvaluator)
        return list
    }, [evaluators])

    const {revisions: variantsData, isLoading: _variantsLoading} = useStatelessVariants({
        lightLoading: true,
    })
    // For online evaluations, do not use variants data (no variant/testset context)
    const effectiveVariantsData =
        evalType === "online" ? [] : isProjectScope ? (variantsData ?? []) : variantsData

    const enrichRun = useCallback(
        (
            run: SnakeToCamelCaseKeys<EvaluationRun>,
            testsetData?: PreviewTestset[],
            runIndex?: RunIndex,
            options?: {variantConfigs?: Record<string, any>},
        ) => {
            // Derive transformed parameters and flags per revision on-demand from atoms
            const store = getDefaultStore()
            const revisionIds: string[] = runIndex
                ? Array.from(
                      new Set(
                          Object.values(runIndex.steps)
                              .map((m: any) => m?.refs?.applicationRevision?.id)
                              .filter(Boolean) as string[],
                      ),
                  )
                : []

            const parametersByRevisionId: Record<string, any> = {}
            const flagsByRevisionId: Record<string, any> = {}
            for (const rid of revisionIds) {
                parametersByRevisionId[rid] = store.get(
                    transformedPromptsAtomFamily({revisionId: rid, useStableParams: true}),
                )
                flagsByRevisionId[rid] = store.get(variantFlagsAtomFamily({revisionId: rid}))
            }

            const result = enrichEvaluationRun({
                run,
                testsets: testsetData || [],
                variantsData: effectiveVariantsData || [],
                evaluators: (combinedEvaluators as EvaluatorDto[]) || [],
                members,
                runIndex,
                extras: {
                    parametersByRevisionId,
                    flagsByRevisionId,
                    variantConfigs: options?.variantConfigs,
                },
                projectScope: isProjectScope,
                appNameById: appNames,
            }) as EnrichedEvaluationRun

            // For online evaluations, explicitly drop variants and testsets (no variant/testset context)
            if (evalType === "online") {
                ;(result as any).variants = []
                ;(result as any).testsets = []
            }

            // Optional: add debug logs here if needed

            return result
        },
        [effectiveVariantsData, combinedEvaluators, members, isProjectScope, appNames],
    )

    const evaluatorsReady = !loadingEvaluators && Array.isArray(combinedEvaluators)

    return !_variantsLoading && evaluatorsReady ? enrichRun : undefined
}

export default useEnrichEvaluationRun

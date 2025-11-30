import {memo, useCallback, useEffect, useMemo, useRef, useState} from "react"
import type {ReactNode, UIEvent} from "react"

import {DownOutlined} from "@ant-design/icons"
import {Button, Card, Skeleton, Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {compareRunIdsAtom, getComparisonColor} from "../../../atoms/compare"
import {
    evaluationQueryReferenceAtomFamily,
    evaluationQueryRevisionAtomFamily,
} from "../../../atoms/query"
import {
    runDisplayNameAtomFamily,
    runStatusAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
} from "../../../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {evaluationVariantConfigAtomFamily} from "../../../atoms/variantConfig"
import {useRunMetricData, type RunDescriptor} from "../OverviewView/hooks/useRunMetricData"

import EvaluatorSection from "./components/EvaluatorSection"
import GeneralSection from "./components/GeneralSection"
import InvocationSection from "./components/InvocationSection"
import QuerySection from "./components/QuerySection"
import {SectionCard, SectionSkeleton} from "./components/SectionPrimitives"
import TestsetSection from "./components/TestsetSection"
import {hasQueryReference} from "./utils"

const {Text, Title} = Typography

interface ConfigurationViewProps {
    runId: string
}

interface ConfigurationRunSummary {
    runId: string
    compareIndex: number
    isBaseRun: boolean
    accentColor: string
    runName: string
    runStatus: string | null
    runSlug: string | null
    generalSubtitle?: string
    testsetSubtitle?: string
    invocationSubtitle?: string
    querySubtitle?: string
    evaluatorSubtitle?: string
    hasTestsets: boolean
    hasInvocation: boolean
    hasQuery: boolean
    hasEvaluatorSection: boolean
    isLoading: boolean
}

const resolveLabel = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        if (trimmed) return trimmed
    }
    return undefined
}

const configurationRunSummaryAtomFamily = atomFamily(
    ({runId, compareIndex}: {runId: string; compareIndex: number}) =>
        atom((get) => {
            const runQuery = get(evaluationRunQueryAtomFamily(runId))
            const runData = runQuery.data?.camelRun ?? runQuery.data?.rawRun ?? null
            const runMeta = (runData?.meta ?? {}) as Record<string, unknown>

            const accentColor = getComparisonColor(compareIndex)
            const isBaseRun = compareIndex === 0

            const runName = get(runDisplayNameAtomFamily(runId)) ?? "—"
            const runStatus = get(runStatusAtomFamily(runId)) ?? null
            const runSlug =
                typeof runData?.slug === "string"
                    ? runData.slug
                    : typeof runMeta?.slug === "string"
                      ? (runMeta.slug as string)
                      : null

            const invocationRefs = get(runInvocationRefsAtomFamily(runId))
            const rawInvocationRefs = invocationRefs.rawRefs ?? {}
            const testsetIds = get(runTestsetIdsAtomFamily(runId)) ?? []
            const testsetCount = testsetIds.length

            const queryReference = get(evaluationQueryReferenceAtomFamily(runId)) ?? {}
            const queryRevisionQuery = get(evaluationQueryRevisionAtomFamily(runId))
            const queryRevision = queryRevisionQuery.data?.revision ?? null
            const queryRevisionVersionLabel =
                queryRevision?.version ?? (queryReference as any).queryRevisionVersion ?? undefined
            const queryHasReference = hasQueryReference(queryReference)

            const variantConfigQuery = get(evaluationVariantConfigAtomFamily(runId))
            const variantConfig = variantConfigQuery.data

            const applicationRef =
                rawInvocationRefs.application ?? rawInvocationRefs.application_ref ?? {}
            const applicationRevisionRef =
                rawInvocationRefs.applicationRevision ??
                rawInvocationRefs.application_revision ??
                {}
            const applicationVariantRef =
                rawInvocationRefs.applicationVariant ?? rawInvocationRefs.application_variant ?? {}

            const variantHeaderLabel = (() => {
                const variantRef =
                    (variantConfig as any)?.variant_ref ??
                    (variantConfig as any)?.variantRef ??
                    applicationVariantRef ??
                    {}
                return (
                    resolveLabel(
                        variantRef?.name,
                        applicationVariantRef?.name,
                        applicationVariantRef?.variant_name,
                        variantRef?.slug,
                        applicationVariantRef?.slug,
                        applicationRevisionRef?.slug,
                    ) ?? undefined
                )
            })()

            const applicationHeaderLabel = (() => {
                const variantApplicationRef =
                    (variantConfig as any)?.application_ref ??
                    (variantConfig as any)?.applicationRef ??
                    applicationRef ??
                    {}
                return (
                    resolveLabel(
                        variantApplicationRef?.name,
                        applicationRef?.name,
                        applicationRef?.app_name,
                        variantApplicationRef?.slug,
                        applicationRef?.slug,
                        applicationRef?.app_slug,
                    ) ?? undefined
                )
            })()

            const variantVersionLabel = (() => {
                const variantRef =
                    (variantConfig as any)?.variant_ref ??
                    (variantConfig as any)?.variantRef ??
                    applicationVariantRef ??
                    {}
                const rawVersion =
                    variantRef?.version ??
                    variantRef?.revision ??
                    applicationRevisionRef?.version ??
                    applicationRevisionRef?.revision ??
                    null
                if (rawVersion === null || rawVersion === undefined) return undefined
                const text = String(rawVersion).trim()
                return text ? `v${text}` : undefined
            })()

            const invocationHeaderSubtitle = (() => {
                const parts: string[] = []
                if (applicationHeaderLabel) parts.push(applicationHeaderLabel)
                const variantParts: string[] = []
                if (variantHeaderLabel) variantParts.push(variantHeaderLabel)
                if (variantVersionLabel) variantParts.push(variantVersionLabel)
                if (variantParts.length) parts.push(variantParts.join(" | "))
                return parts.join(" | ") || undefined
            })()

            const testsetHeaderSubtitle =
                testsetCount === 0
                    ? undefined
                    : testsetCount === 1
                      ? "1 linked set"
                      : `${testsetCount} linked sets`

            const queryHeaderSubtitle = (() => {
                const base = resolveLabel(
                    (queryReference as any).querySlug,
                    (queryReference as any).queryId,
                    queryRevision?.slug,
                    queryRevision?.id,
                )
                const parts: string[] = []
                if (base) parts.push(base)
                if (
                    queryRevisionVersionLabel !== undefined &&
                    queryRevisionVersionLabel !== null &&
                    String(queryRevisionVersionLabel).trim() !== ""
                ) {
                    parts.push(`rev ${queryRevisionVersionLabel}`)
                }
                return parts.join(" | ") || undefined
            })()

            const evaluatorsQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
            const evaluatorsLoading = evaluatorsQuery.isPending || evaluatorsQuery.isFetching
            const evaluatorError = evaluatorsQuery.error
            const evaluatorCount = Array.isArray(evaluatorsQuery.data)
                ? evaluatorsQuery.data.length
                : 0

            const evaluatorHeaderSubtitle = (() => {
                if (evaluatorsLoading) return "Loading..."
                if (evaluatorError) return "Error"
                if (evaluatorCount) {
                    return `${evaluatorCount} ${evaluatorCount === 1 ? "evaluator" : "evaluators"}`
                }
                return undefined
            })()

            const generalHeaderSubtitle = (() => {
                const label = resolveLabel(
                    runName !== "—" ? runName : undefined,
                    runSlug ?? undefined,
                )
                return label ?? undefined
            })()

            const isLoading = runQuery.isPending || runQuery.isFetching

            return {
                runId,
                compareIndex,
                isBaseRun,
                accentColor,
                runName,
                runStatus,
                runSlug,
                generalSubtitle: generalHeaderSubtitle,
                testsetSubtitle: testsetHeaderSubtitle,
                invocationSubtitle: invocationHeaderSubtitle,
                querySubtitle: queryHeaderSubtitle,
                evaluatorSubtitle: evaluatorHeaderSubtitle,
                hasTestsets: testsetCount > 0,
                hasInvocation: Boolean(rawInvocationRefs && Object.keys(rawInvocationRefs).length),
                hasQuery: queryHasReference,
                hasEvaluatorSection:
                    evaluatorsLoading || Boolean(evaluatorError) || evaluatorCount > 0,
                isLoading,
            } satisfies ConfigurationRunSummary
        }),
)

const useScrollSync = () => {
    const containersRef = useRef(new Map<string, HTMLDivElement>())
    const isSyncingRef = useRef(false)

    const register = useCallback((key: string, node: HTMLDivElement | null) => {
        const map = containersRef.current
        if (!node) {
            map.delete(key)
            return
        }
        map.set(key, node)
    }, [])

    const syncScroll = useCallback((key: string, scrollLeft: number) => {
        if (isSyncingRef.current) return
        const map = containersRef.current
        if (map.size <= 1) return
        isSyncingRef.current = true
        map.forEach((container, containerKey) => {
            if (!container || containerKey === key) return
            if (container.scrollLeft !== scrollLeft) {
                container.scrollLeft = scrollLeft
            }
        })
        requestAnimationFrame(() => {
            isSyncingRef.current = false
        })
    }, [])

    return {register, syncScroll}
}

interface SectionDefinition {
    key: string
    title: string
    alwaysVisible?: boolean
    hasData: (summary: ConfigurationRunSummary) => boolean
    getSubtitle?: (summary?: ConfigurationRunSummary) => string | undefined
    render: (runId: string, context?: {compareIndex: number}) => ReactNode
    fallbackMessage?: string
}

const sectionDefinitions: SectionDefinition[] = [
    {
        key: "general",
        title: "General",
        alwaysVisible: true,
        hasData: () => true,
        // getSubtitle: (summary) => null,
        // getSubtitle: (summary) => summary?.generalSubtitle,
        render: (runId, context) => (
            <GeneralSection runId={runId} showActions={(context?.compareIndex ?? 0) === 0} />
        ),
    },
    {
        key: "testsets",
        title: "Test sets",
        hasData: (summary) => summary.hasTestsets,
        getSubtitle: (summary) => summary?.testsetSubtitle,
        render: (runId) => <TestsetSection runId={runId} />,
        fallbackMessage: "No linked test sets.",
    },
    {
        key: "invocation",
        title: "Application",
        hasData: (summary) => summary.hasInvocation,
        getSubtitle: (summary) => summary?.invocationSubtitle,
        render: (runId) => <InvocationSection runId={runId} />,
        fallbackMessage: "Application metadata unavailable.",
    },
    {
        key: "query",
        title: "Query configuration",
        hasData: (summary) => summary.hasQuery,
        getSubtitle: (summary) => summary?.querySubtitle,
        render: (runId) => <QuerySection runId={runId} />,
        fallbackMessage: "No query linked to this evaluation.",
    },
]

const ConfigurationSectionColumn = memo(
    ({
        runId,
        compareIndex,
        section,
        headerTitle,
        collapsed,
        onToggleCollapse,
    }: {
        runId: string
        compareIndex: number
        section: SectionDefinition
        headerTitle?: string
        collapsed?: boolean
        onToggleCollapse?: () => void
    }) => {
        const summaryAtom = useMemo(
            () => configurationRunSummaryAtomFamily({runId, compareIndex}),
            [runId, compareIndex],
        )
        const summary = useAtomValue(summaryAtom)

        const columnHasData = section.hasData(summary)

        let content: ReactNode = null
        if (summary.isLoading) {
            content = <SectionSkeleton />
        } else if (columnHasData || section.alwaysVisible) {
            content = section.render(runId, {compareIndex})
        } else if (section.fallbackMessage) {
            content = <Text className="text-neutral-500">{section.fallbackMessage}</Text>
        }

        const accentColor =
            !summary.isBaseRun && summary.accentColor !== "transparent"
                ? summary.accentColor
                : undefined

        if (
            section.key === "evaluators" ||
            section.key === "testsets" ||
            section.key === "invocation"
        ) {
            return (
                <div className="flex flex-col gap-6 px-0 py-2" style={{borderColor: accentColor}}>
                    {content}
                </div>
            )
        }

        const card = (
            <SectionCard
                className="h-full"
                style={accentColor ? {borderColor: accentColor} : undefined}
            >
                {headerTitle ? (
                    <div className="flex items-center justify-between gap-2">
                        <Text className="text-base font-semibold text-neutral-900">
                            {headerTitle}
                        </Text>
                        <Button
                            type="text"
                            size="small"
                            icon={
                                <DownOutlined rotate={collapsed ? -90 : 0} style={{fontSize: 12}} />
                            }
                            onClick={onToggleCollapse}
                        />
                    </div>
                ) : null}
                {!collapsed ? content : null}
            </SectionCard>
        )

        return card
    },
)

const ConfigurationSectionRow = memo(
    ({
        section,
        runIds,
        runIdsSignature,
        runDescriptors,
        registerScrollContainer,
        syncScroll,
    }: {
        section: SectionDefinition
        runIds: string[]
        runIdsSignature: string
        runDescriptors: RunDescriptor[]
        registerScrollContainer: (key: string, node: HTMLDivElement | null) => void
        syncScroll: (key: string, scrollLeft: number) => void
    }) => {
        const [collapsed, setCollapsed] = useState(false)
        useEffect(() => {
            setCollapsed(false)
        }, [runIdsSignature, section.key])

        const sectionVisibleAtom = useMemo(
            () =>
                atom((get) => {
                    if (section.alwaysVisible) {
                        return true
                    }
                    return runIds.some((runId, index) => {
                        const summary = get(
                            configurationRunSummaryAtomFamily({runId, compareIndex: index}),
                        )
                        return summary.isLoading || section.hasData(summary)
                    })
                }),
            [runIds, runIdsSignature, section],
        )
        const sectionVisible = useAtomValue(sectionVisibleAtom)

        const refKey = `section-${section.key}`
        const handleRef = useCallback(
            (node: HTMLDivElement | null) => registerScrollContainer(refKey, node),
            [refKey, registerScrollContainer],
        )
        const handleScroll = useCallback(
            (event: UIEvent<HTMLDivElement>) => syncScroll(refKey, event.currentTarget.scrollLeft),
            [refKey, syncScroll],
        )

        if (!sectionVisible) {
            return null
        }

        const showRowHeader = false
        // section.key === "general" || section.key === "query"

        const grid = (
            <div
                ref={handleRef}
                onScroll={handleScroll}
                className="grid grid-flow-col auto-cols-[minmax(320px,1fr)] gap-4 overflow-x-auto pb-2"
            >
                {runIds.map((runId, index) => (
                    <ConfigurationSectionColumn
                        key={`${section.key}-${runId}`}
                        runId={runId}
                        compareIndex={index}
                        section={section}
                        headerTitle={showRowHeader ? section.title : undefined}
                        collapsed={showRowHeader ? collapsed : false}
                        onToggleCollapse={showRowHeader ? () => setCollapsed((v) => !v) : undefined}
                    />
                ))}
            </div>
        )

        return <div className="flex flex-col gap-2">{grid}</div>
    },
)

const ConfigurationLayout = memo(({runIds}: {runIds: string[]}) => {
    const runIdsSignature = useMemo(() => runIds.join("|"), [runIds])
    const {register, syncScroll} = useScrollSync()
    const {runDescriptors} = useRunMetricData(runIds)

    return (
        <div className="flex flex-col gap-4 pb-6">
            {sectionDefinitions.map((section) => (
                <ConfigurationSectionRow
                    key={section.key}
                    section={section}
                    runIds={runIds}
                    runIdsSignature={runIdsSignature}
                    runDescriptors={runDescriptors}
                    registerScrollContainer={register}
                    syncScroll={syncScroll}
                />
            ))}
            {/* Render evaluators without a shared wrapper; each run renders its own evaluator cards directly */}
            <div className="grid grid-flow-col auto-cols-[minmax(320px,1fr)] gap-4 overflow-x-auto pb-2">
                {runIds.map((runId) => (
                    <div key={`evaluators-${runId}`} className="flex flex-col gap-4">
                        <EvaluatorSection runId={runId} />
                    </div>
                ))}
            </div>
        </div>
    )
})

const ConfigurationView = ({runId}: ConfigurationViewProps) => {
    const compareRunIds = useAtomValue(compareRunIdsAtom)

    const runIds = useMemo(() => {
        const unique = new Set<string>()
        const order: string[] = []
        const push = (id?: string | null) => {
            if (!id) return
            if (unique.has(id)) return
            unique.add(id)
            order.push(id)
        }
        push(runId)
        compareRunIds.forEach((id) => push(id))
        return order
    }, [runId, compareRunIds])

    if (!runIds.length) {
        return null
    }

    return (
        <div className="flex h-full min-h-0 flex-col px-6 pt-2 bg-zinc-1">
            <div className="flex-1 overflow-y-auto">
                <ConfigurationLayout runIds={runIds} />
            </div>
        </div>
    )
}

export default memo(ConfigurationView)

import {memo, useMemo, useState} from "react"

import {Segmented, Typography} from "antd"
import {atom, useAtomValue} from "jotai"
import {atomFamily} from "jotai/utils"

import {compareRunIdsAtom, getComparisonColor} from "../../../atoms/compare"
import {
    runDisplayNameAtomFamily,
    runInvocationRefsAtomFamily,
    runTestsetIdsAtomFamily,
    runTestsetRefsAtomFamily,
} from "../../../atoms/runDerived"
import {evaluationRunQueryAtomFamily} from "../../../atoms/table"
import {evaluationEvaluatorsByRunQueryAtomFamily} from "../../../atoms/table/evaluators"
import {simpleTestsetDetailsAtomFamily} from "../../../atoms/testsetDetails"
import {evaluationVariantConfigAtomFamily} from "../../../atoms/variantConfig"

import EvaluatorSection from "./components/EvaluatorSection"
import InvocationSection from "./components/InvocationSection"
import RunSummaryCard from "./components/RunSummaryCard"
import SectionNavCard from "./components/SectionNavCard"
import {SectionSkeleton} from "./components/SectionPrimitives"
import TestsetSection from "./components/TestsetSection"
import V2SectionShell from "./components/V2SectionShell"

const {Text} = Typography

interface ConfigurationViewProps {
    runId: string
}

const resolveLabel = (...values: unknown[]) => {
    for (const value of values) {
        if (typeof value !== "string") continue
        const trimmed = value.trim()
        if (trimmed) return trimmed
    }
    return undefined
}

interface ConfigurationRunSummary {
    testsetSubtitle?: string
    invocationSubtitle?: string
    testsetCount: number
    evaluatorCount: number
    hasTestsets: boolean
    hasInvocation: boolean
    hasEvaluatorSection: boolean
    isLoading: boolean
}

const configurationRunSummaryAtomFamily = atomFamily((runId: string) =>
    atom((get) => {
        const runQuery = get(evaluationRunQueryAtomFamily(runId))

        const invocationRefs = get(runInvocationRefsAtomFamily(runId))
        const rawInvocationRefs = invocationRefs.rawRefs ?? {}
        const testsetIds = get(runTestsetIdsAtomFamily(runId)) ?? []
        const testsetCount = testsetIds.length

        const variantConfigQuery = get(evaluationVariantConfigAtomFamily(runId))
        const variantConfig = variantConfigQuery.data

        const applicationRef =
            rawInvocationRefs.application ?? rawInvocationRefs.application_ref ?? {}
        const applicationRevisionRef =
            rawInvocationRefs.applicationRevision ?? rawInvocationRefs.application_revision ?? {}
        const applicationVariantRef =
            rawInvocationRefs.applicationVariant ?? rawInvocationRefs.application_variant ?? {}

        const variantRef =
            (variantConfig as any)?.variant_ref ??
            (variantConfig as any)?.variantRef ??
            applicationVariantRef ??
            {}
        const variantApplicationRef =
            (variantConfig as any)?.application_ref ??
            (variantConfig as any)?.applicationRef ??
            applicationRef ??
            {}

        const applicationHeaderLabel = resolveLabel(
            variantApplicationRef?.name,
            applicationRef?.name,
            // App refs often carry only id/slug; the variant name reads better
            // in the summary than an opaque slug.
            variantRef?.name,
            variantApplicationRef?.slug,
            applicationRef?.slug,
        )

        const variantVersionLabel = (() => {
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

        // One-line section summary, e.g. "Hotel Agent (LangGraph, vanilla) · v25"
        const invocationHeaderSubtitle =
            [applicationHeaderLabel, variantVersionLabel].filter(Boolean).join(" · ") || undefined

        // One-line summary, e.g. "12 test cases · 5 columns"
        const testsetHeaderSubtitle = (() => {
            if (!testsetCount) return undefined
            if (testsetCount === 1) {
                const details = get(simpleTestsetDetailsAtomFamily(testsetIds[0]))
                const simple = details.data
                const parts: string[] = []
                if (typeof simple?.testcaseCount === "number" && simple.testcaseCount >= 0) {
                    parts.push(
                        `${simple.testcaseCount} test case${simple.testcaseCount === 1 ? "" : "s"}`,
                    )
                }
                if (simple?.columnNames?.length) {
                    parts.push(
                        `${simple.columnNames.length} column${simple.columnNames.length === 1 ? "" : "s"}`,
                    )
                }
                if (parts.length) return parts.join(" · ")
                return undefined
            }
            return `${testsetCount} linked sets`
        })()

        const evaluatorsQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
        const evaluatorsLoading = evaluatorsQuery.isPending || evaluatorsQuery.isFetching
        const evaluatorCount = Array.isArray(evaluatorsQuery.data) ? evaluatorsQuery.data.length : 0

        return {
            testsetSubtitle: testsetHeaderSubtitle,
            invocationSubtitle: invocationHeaderSubtitle,
            testsetCount,
            evaluatorCount,
            hasTestsets: testsetCount > 0,
            hasInvocation: Boolean(rawInvocationRefs && Object.keys(rawInvocationRefs).length),
            hasEvaluatorSection:
                evaluatorsLoading || Boolean(evaluatorsQuery.error) || evaluatorCount > 0,
            // Data-aware: background refetches must not unmount the sections
            // (that would reset collapse state and tear down JSON editors).
            isLoading: runQuery.isPending && !runQuery.data,
        } satisfies ConfigurationRunSummary
    }),
)

/* ---------- Compare diffs ---------- */

interface ConfigurationDiff {
    testset: boolean
    app: boolean
    variant: boolean
    evaluators: Record<string, boolean>
}

/** Comparable configuration identifiers for one run. */
const runComparablesAtomFamily = atomFamily((runId: string) =>
    atom((get) => {
        const testsetRefs = get(runTestsetRefsAtomFamily(runId)) ?? []
        const invocationRefs = get(runInvocationRefsAtomFamily(runId))
        const raw = invocationRefs.rawRefs ?? {}
        const applicationRef = raw.application ?? raw.application_ref ?? {}
        const revisionRef = raw.applicationRevision ?? raw.application_revision ?? {}
        const evaluatorsQuery = get(evaluationEvaluatorsByRunQueryAtomFamily(runId))
        const evaluators = Array.isArray(evaluatorsQuery.data) ? evaluatorsQuery.data : []

        return {
            testsetIdsKey: testsetRefs
                .map((ref: any) => String(ref.testsetId))
                .sort()
                .join("|"),
            testsetRevisions: Object.fromEntries(
                testsetRefs.map((ref: any) => [ref.testsetId, ref.revisionId ?? null]),
            ) as Record<string, string | null>,
            appId: applicationRef?.id ?? null,
            variantRevisionId: revisionRef?.id ?? null,
            variantVersion: revisionRef?.version ?? revisionRef?.revision ?? null,
            evaluatorVersions: Object.fromEntries(
                evaluators.map((evaluator: any) => [
                    evaluator.slug ?? evaluator.id,
                    evaluator.version ?? null,
                ]),
            ) as Record<string, unknown>,
        }
    }),
)

/**
 * Configuration diff vs the base run. Only configuration identity counts
 * (test set, variant version, evaluator versions) — never general fields.
 */
const configurationDiffAtomFamily = atomFamily(
    ({runId, baseRunId}: {runId: string; baseRunId: string}) =>
        atom((get): ConfigurationDiff => {
            const current = get(runComparablesAtomFamily(runId))
            const base = get(runComparablesAtomFamily(baseRunId))

            const evaluators: Record<string, boolean> = {}
            for (const [slug, version] of Object.entries(current.evaluatorVersions)) {
                evaluators[slug] =
                    !(slug in base.evaluatorVersions) || base.evaluatorVersions[slug] !== version
            }

            // Revisions only count when both runs carry one for the same test
            // set — legacy runs without testset_revision refs must not flag.
            const testsetRevisionDiffers = Object.entries(current.testsetRevisions).some(
                ([testsetId, revisionId]) => {
                    const baseRevisionId = base.testsetRevisions[testsetId]
                    return Boolean(revisionId && baseRevisionId && revisionId !== baseRevisionId)
                },
            )

            return {
                testset: current.testsetIdsKey !== base.testsetIdsKey || testsetRevisionDiffers,
                app: current.appId !== base.appId,
                variant:
                    current.variantRevisionId !== base.variantRevisionId ||
                    current.variantVersion !== base.variantVersion,
                evaluators,
            }
        }),
    (a, b) => a.runId === b.runId && a.baseRunId === b.baseRunId,
)

/* ---------- Sections stack (shared by single + compare columns) ---------- */

const V2SectionStack = memo(
    ({
        runId,
        diff,
        defaultOpenFirstEvaluator = false,
        anchorSuffix = "",
        showEmptySections = false,
    }: {
        runId: string
        diff: ConfigurationDiff | null
        defaultOpenFirstEvaluator?: boolean
        anchorSuffix?: string
        /** Compare mode: keep empty sections visible so absences read as differences. */
        showEmptySections?: boolean
    }) => {
        const summaryAtom = useMemo(() => configurationRunSummaryAtomFamily(runId), [runId])
        const summary = useAtomValue(summaryAtom)

        const variantConfigAtom = useMemo(() => evaluationVariantConfigAtomFamily(runId), [runId])
        const variantConfigQuery = useAtomValue(variantConfigAtom)
        const appHasSchema = Boolean(variantConfigQuery.data?.url)
        const appHasConfig = Boolean(variantConfigQuery.data)
        const [appView, setAppView] = useState<"details" | "json">("details")

        if (summary.isLoading) {
            return (
                <>
                    <SectionSkeleton lines={3} />
                    <SectionSkeleton lines={4} />
                </>
            )
        }

        return (
            <>
                {summary.hasTestsets || showEmptySections ? (
                    <V2SectionShell
                        id={`config-section-testsets${anchorSuffix}`}
                        title="Test set"
                        count={summary.testsetCount > 1 ? summary.testsetCount : null}
                        summary={summary.testsetSubtitle}
                    >
                        {summary.hasTestsets ? (
                            <TestsetSection
                                runId={runId}
                                embedded
                                differs={Boolean(diff?.testset)}
                            />
                        ) : (
                            <Text type="secondary">No linked test sets.</Text>
                        )}
                    </V2SectionShell>
                ) : null}

                {summary.hasInvocation || showEmptySections ? (
                    <V2SectionShell
                        id={`config-section-invocation${anchorSuffix}`}
                        title="Application"
                        summary={summary.invocationSubtitle}
                        headerRight={
                            summary.hasInvocation && appHasConfig && appHasSchema ? (
                                <Segmented
                                    options={[
                                        {label: "Details", value: "details"},
                                        {label: "JSON", value: "json"},
                                    ]}
                                    size="small"
                                    value={appView}
                                    onChange={(value) => setAppView(value as "details" | "json")}
                                />
                            ) : null
                        }
                    >
                        {summary.hasInvocation ? (
                            <InvocationSection
                                runId={runId}
                                embedded
                                view={appView}
                                diff={diff ? {app: diff.app, variant: diff.variant} : null}
                            />
                        ) : (
                            <Text type="secondary">Application metadata unavailable.</Text>
                        )}
                    </V2SectionShell>
                ) : null}

                {summary.hasEvaluatorSection || showEmptySections ? (
                    <V2SectionShell
                        id={`config-section-evaluators${anchorSuffix}`}
                        title="Evaluators"
                        count={summary.evaluatorCount > 0 ? summary.evaluatorCount : null}
                        flush={summary.hasEvaluatorSection}
                    >
                        {summary.hasEvaluatorSection ? (
                            <EvaluatorSection
                                runId={runId}
                                embedded
                                diffSlugs={diff?.evaluators ?? null}
                                defaultOpenFirst={defaultOpenFirstEvaluator}
                            />
                        ) : (
                            <Text type="secondary">No evaluator reference found for this run.</Text>
                        )}
                    </V2SectionShell>
                ) : null}
            </>
        )
    },
)

/* ---------- Single-run layout: sticky rail + sections ---------- */

const V2Single = memo(({runId}: {runId: string}) => (
    <div className="grid grid-cols-1 items-start gap-4 @[860px]:grid-cols-[264px_minmax(0,1fr)]">
        <div className="flex flex-col gap-3 @[860px]:sticky @[860px]:top-4">
            <RunSummaryCard runId={runId} />
            <div className="hidden @[860px]:block">
                <SectionNavCard runId={runId} />
            </div>
        </div>
        <div className="flex min-w-0 flex-col gap-4">
            {/* key: collapse/view state must not leak between runs */}
            <V2SectionStack key={runId} runId={runId} diff={null} defaultOpenFirstEvaluator />
        </div>
    </div>
))

/* ---------- Compare layout: one column per run ---------- */

const V2CompareColumn = memo(
    ({runId, baseRunId, index}: {runId: string; baseRunId: string; index: number}) => {
        const runName = useAtomValue(useMemo(() => runDisplayNameAtomFamily(runId), [runId]))
        const diffAtom = useMemo(
            () => configurationDiffAtomFamily({runId, baseRunId}),
            [runId, baseRunId],
        )
        const diff = useAtomValue(diffAtom)
        const isBase = index === 0
        const comparisonColor = getComparisonColor(index)
        const swatchColor = isBase
            ? "#1c2c3d"
            : comparisonColor !== "transparent"
              ? comparisonColor
              : "#2f54eb"

        return (
            <div className="flex min-w-0 flex-col gap-4">
                {/* Sticky so the run identity stays visible while scrolling long columns */}
                <div className="sticky top-0 z-10 flex items-center gap-2 rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer px-3 py-2">
                    <span
                        className="h-2 w-2 shrink-0 rounded-[2px]"
                        style={{backgroundColor: swatchColor}}
                    />
                    <Text className="min-w-0 truncate text-[13px] font-medium">
                        {runName ?? runId}
                    </Text>
                </div>
                <RunSummaryCard runId={runId} />
                <V2SectionStack
                    key={runId}
                    runId={runId}
                    diff={isBase ? null : diff}
                    anchorSuffix={`-${runId}`}
                    showEmptySections
                />
            </div>
        )
    },
)

const V2Compare = memo(({runIds}: {runIds: string[]}) => (
    <div className="grid grid-cols-1 gap-4 @[1100px]:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        {runIds.map((runId, index) => (
            <V2CompareColumn key={runId} runId={runId} baseRunId={runIds[0]} index={index} />
        ))}
    </div>
))

/* ---------- Entry ---------- */

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
        <div className="h-full min-h-0 overflow-y-auto bg-zinc-1 @container">
            <div className="p-4 pb-6">
                {runIds.length > 1 ? <V2Compare runIds={runIds} /> : <V2Single runId={runId} />}
            </div>
        </div>
    )
}

export default memo(ConfigurationView)

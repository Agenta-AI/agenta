import {memo, useMemo} from "react"

import {Typography, Tooltip} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import Link from "next/link"

import EvalNameTag from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/EvalNameTag"
import {EVAL_TAG_COLOR} from "@/oss/components/EvalRunDetails/AutoEvalRun/assets/utils"
import {evalTypeAtom} from "@/oss/components/EvalRunDetails/state/evalType"
import {useRunId} from "@/oss/contexts/RunIdContext"
import useURL from "@/oss/hooks/useURL"
import {evaluationRunStateFamily} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {useInvocationResult} from "@/oss/lib/hooks/useInvocationResult"

const {Text} = Typography

const GenerationResultUtils = dynamic(
    () =>
        import(
            "@/oss/components/Playground/Components/PlaygroundGenerations/assets/GenerationResultUtils"
        ),
    {ssr: false},
)

const RunTraceHeader = ({
    runId: rId,
    scenarioId: scId,
    stepKey,
    anchorId,
    showComparisons,
}: {
    runId: string
    scenarioId?: string
    stepKey?: string
    anchorId?: string
    showComparisons?: boolean
}) => {
    const baseRunId = useRunId()
    const state = useAtomValue(evaluationRunStateFamily(rId))
    const enriched = state?.enrichedRun
    const {buildUrl} = useURL()
    const {trace: runTrace} = useInvocationResult({
        scenarioId: scId,
        stepKey: stepKey,
        editorType: "simple",
        viewType: "single",
        runId: rId,
    })
    const evaluationType = useAtomValue(evalTypeAtom)
    const isOnlineEval = evaluationType === "online"

    const {appSummary, appTooltip, appHref, context} = useMemo(() => {
        const toStr = (value: unknown) => {
            if (typeof value !== "string") return undefined
            const trimmed = value.trim()
            return trimmed.length ? trimmed : undefined
        }

        const pickFirst = (...values: unknown[]) => {
            for (const value of values) {
                const str = toStr(value)
                if (str) return str
            }
            return undefined
        }
        const computeFromRunIndex = () => {
            const stepMeta = stepKey ? state?.runIndex?.steps?.[stepKey] : undefined
            const refs = (stepMeta as any)?.refs || {}
            const revisionRef =
                refs?.applicationRevision || refs?.application_revision || refs?.revision || {}
            const applicationRef =
                refs?.application ||
                refs?.applicationRef ||
                refs?.application_ref ||
                (revisionRef as any)?.application ||
                {}

            const revisionId = pickFirst(
                revisionRef?.id,
                revisionRef?.variantId,
                revisionRef?.revisionId,
            )
            const variants = Array.isArray(enriched?.variants)
                ? (enriched?.variants as unknown[] as Record<string, any>[])
                : []
            const matchedVariant =
                (revisionId
                    ? variants.find((variant: Record<string, any>) => {
                          const candidates = [
                              toStr(variant?.id),
                              toStr(variant?.variantId),
                              toStr(variant?._revisionId),
                              toStr(variant?.revisionId),
                          ].filter(Boolean)
                          return candidates.includes(revisionId)
                      })
                    : undefined) || variants[0]

            const appName = pickFirst(
                applicationRef?.name,
                applicationRef?.slug,
                matchedVariant?.appName,
                matchedVariant?.application?.name,
                enriched?.appName,
                (enriched as any)?.app_name,
                (enriched as any)?.app?.name,
            )

            const appId = pickFirst(
                applicationRef?.id,
                revisionRef?.applicationId,
                matchedVariant?.appId,
                matchedVariant?.application?.id,
                enriched?.appId,
                (enriched as any)?.app_id,
                (enriched as any)?.app?.id,
            )

            const variantName = pickFirst(
                revisionRef?.variantName,
                revisionRef?.name,
                matchedVariant?.variantName,
                matchedVariant?.name,
            )

            const revisionLabel = pickFirst(
                revisionRef?.revisionLabel,
                revisionRef?.revision,
                revisionRef?.version,
                matchedVariant?.revision,
                matchedVariant?.version,
            )

            return {appId, appName, variantName, revisionLabel}
        }

        const computeFromTrace = () => {
            if (!runTrace) return {}

            const collectedRefs: any[] = []
            const addRef = (ref: any, keyHint?: string) => {
                if (!ref || typeof ref !== "object") return
                const normalized = {...ref}
                if (keyHint && !normalized.key) normalized.key = keyHint
                if (keyHint && normalized.attributes && !normalized.attributes.key) {
                    normalized.attributes = {...normalized.attributes, key: keyHint}
                }
                collectedRefs.push(normalized)
            }

            const pushRefs = (node: any) => {
                if (!node || typeof node !== "object") return

                if (Array.isArray(node.references)) {
                    node.references.forEach((ref: any) => addRef(ref))
                }

                if (node.refs && typeof node.refs === "object") {
                    Object.entries(node.refs).forEach(([key, value]) => {
                        if (Array.isArray(value)) {
                            value.forEach((entry) => addRef(entry, key))
                        } else {
                            addRef(value, key)
                        }
                    })
                }

                if (Array.isArray(node.nodes)) {
                    node.nodes.forEach(pushRefs)
                } else if (node.nodes && typeof node.nodes === "object") {
                    Object.values(node.nodes).forEach(pushRefs)
                }

                if (Array.isArray(node.children)) {
                    node.children.forEach(pushRefs)
                }
            }

            pushRefs(runTrace)
            if (runTrace?.tree) pushRefs(runTrace.tree)

            const findRef = (...keys: string[]) =>
                collectedRefs.find((ref: any) => {
                    const refKey = pickFirst(ref?.attributes?.key, ref?.key)
                    return refKey ? keys.includes(refKey) : false
                })

            const appRef = findRef("application", "app")
            const variantRef = findRef(
                "application_revision",
                "application_variant",
                "variant",
                "revision",
            )

            const appId = pickFirst(
                appRef?.id,
                appRef?.attributes?.id,
                appRef?.attributes?.applicationId,
                appRef?.attributes?.appId,
            )
            const appName = pickFirst(
                appRef?.attributes?.name,
                appRef?.attributes?.label,
                appRef?.attributes?.application?.name,
                appRef?.slug,
                appRef?.name,
            )
            const variantName = pickFirst(
                variantRef?.attributes?.name,
                variantRef?.attributes?.variantName,
                variantRef?.slug,
                variantRef?.name,
            )
            const revisionLabel = pickFirst(
                variantRef?.attributes?.revision,
                variantRef?.attributes?.version,
                variantRef?.attributes?.label,
            )

            return {appId, appName, variantName, revisionLabel}
        }

        const runIndexContext = computeFromRunIndex()
        const traceContext = isOnlineEval ? computeFromTrace() : {}
        const context = isOnlineEval
            ? {
                  appId: traceContext.appId || runIndexContext.appId,
                  appName: traceContext.appName || runIndexContext.appName,
                  variantName: traceContext.variantName || runIndexContext.variantName,
                  revisionLabel: traceContext.revisionLabel || runIndexContext.revisionLabel,
              }
            : runIndexContext

        const resolvedAppId = context.appId
        const resolvedAppName = context.appName
        const resolvedVariantName = context.variantName
        const resolvedRevisionLabel = context.revisionLabel

        const variantSummary = resolvedVariantName
            ? `${resolvedVariantName}${resolvedRevisionLabel ? ` v${resolvedRevisionLabel}` : ""}`
            : undefined

        const summaryBase = [resolvedAppName, variantSummary].filter(Boolean).join(" • ")
        const display =
            summaryBase ||
            resolvedAppName ||
            (resolvedAppId ? `App ${resolvedAppId.slice(-6)}` : "Application unavailable")

        const tooltipParts = [
            resolvedAppName ? `App: ${resolvedAppName}` : null,
            resolvedAppId ? `ID: ${resolvedAppId}` : null,
            resolvedVariantName ? `Variant: ${resolvedVariantName}` : null,
            resolvedRevisionLabel ? `Revision: ${resolvedRevisionLabel}` : null,
        ].filter(Boolean) as string[]

        const href = resolvedAppId ? buildUrl({appId: resolvedAppId, isAppUrl: true}) : undefined

        return {
            appSummary: display,
            appTooltip: tooltipParts.length ? tooltipParts.join(" · ") : undefined,
            appHref: href,
            context,
        }
    }, [buildUrl, enriched, isOnlineEval, runTrace, state?.runIndex?.steps, stepKey])

    return (
        <div
            className={clsx(
                showComparisons ? "w-[480px] shrink-0" : "w-full",
                "h-[40px] flex items-center justify-between px-3 border-0 border-r border-solid border-gray-200",
            )}
            id={anchorId}
        >
            <div className="flex items-center gap-3 min-w-0">
                {enriched ? (
                    <EvalNameTag
                        run={enriched}
                        color={
                            EVAL_TAG_COLOR?.[
                                state?.colorIndex ||
                                    (state?.isBase ? 1 : undefined) ||
                                    state?.compareIndex ||
                                    1
                            ]
                        }
                        onlyShowBasePin
                        isBaseEval={enriched?.id === baseRunId}
                        className={clsx("max-w-[200px]", showComparisons ? "truncate" : "")}
                        appContext={{
                            appId: context?.appId,
                            appName: context?.appName,
                            variantName: context?.variantName,
                            revisionLabel: context?.revisionLabel,
                            isOnlineEval,
                        }}
                    />
                ) : (
                    <div className="h-[24.4px] w-[100px]" />
                )}
            </div>
            {runTrace ? (
                <GenerationResultUtils
                    className="flex-row-reverse shrink-0"
                    result={{response: {tree: {nodes: [runTrace]}}}}
                    showStatus={false}
                />
            ) : (
                <div className="h-[24.4px] w-full" />
            )}
        </div>
    )
}

export default memo(RunTraceHeader)

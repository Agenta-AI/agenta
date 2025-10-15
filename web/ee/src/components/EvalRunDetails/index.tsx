import {memo, useCallback, useEffect, useMemo} from "react"

import {Spin, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {createStore, getDefaultStore, Provider, useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"
import {useRouter} from "next/router"

import EvalRunDetails from "@/oss/components/EvalRunDetails/HumanEvalRun"
import ErrorState from "@/oss/components/ErrorState"
import SingleModelEvaluationTable from "@/oss/components/EvaluationTable/SingleModelEvaluationTable"
import {RunIdProvider} from "@/oss/contexts/RunIdContext"
import {useAppId} from "@/oss/hooks/useAppId"
import {appendBreadcrumbAtom, breadcrumbAtom, setBreadcrumbsAtom} from "@/oss/lib/atoms/breadcrumb"
import {isUuid} from "@/oss/lib/helpers/utils"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"
import {
    evalAtomStore,
    evaluationRunStateFamily,
    initializeRun,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {_EvaluationScenario, Evaluation} from "@/oss/lib/Types"
import {abortAll} from "@/oss/lib/utils/abortControllers"

import EvaluationScenarios from "../pages/evaluations/evaluationScenarios/EvaluationScenarios"

import AutoEvalRunDetails from "./AutoEvalRun"
import {ComparisonDataFetcher} from "./components/ComparisonDataFetcher"
import {evalTypeAtom, setEvalTypeAtom} from "./state/evalType"
import {runViewTypeAtom} from "./state/urlState"
import UrlSync from "./UrlSync"

const EvaluationPageData = memo(
    ({children, runId}: {children?: React.ReactNode; runId?: string}) => {
        const router = useRouter()

        // Abort any in-flight data requests when navigating away
        useEffect(() => {
            if (runId) {
                initializeRun(runId)
            }
        }, [runId])

        // Abort any in-flight data requests when navigating away
        useEffect(() => {
            return () => {
                abortAll()
            }
        }, [router.pathname])

        useEvaluationRunData(runId || null, true, runId)
        return runId ? children : null
    },
)

const LegacyEvaluationPage = ({id: evaluationTableId}: {id: string}) => {
    const evalType = useAtomValue(evalTypeAtom)

    const {legacyEvaluationSWR, legacyScenariosSWR} = useEvaluationRunData(
        evaluationTableId || null,
        true,
    )

    if (legacyEvaluationSWR.isLoading || legacyScenariosSWR.isLoading) {
        return (
            <div className="w-full h-[calc(100dvh-70px)] flex items-center justify-center">
                <div className="flex gap-2 items-center justify-center">
                    <Spin spinning={true} />
                    <Typography.Text className="text-[16px] leading-[18px] font-[600]">
                        Loading...
                    </Typography.Text>
                </div>
            </div>
        )
    }

    const data = legacyEvaluationSWR.data

    return data ? (
        evalType === "auto" ? (
            <EvaluationScenarios scenarios={legacyScenariosSWR.data as _EvaluationScenario[]} />
        ) : evalType === "human" ? (
            <SingleModelEvaluationTable
                evaluationScenarios={legacyScenariosSWR.data as any[]}
                evaluation={data as Evaluation}
                isLoading={legacyEvaluationSWR.isLoading || legacyScenariosSWR.isLoading}
            />
        ) : null
    ) : null
}

const PreviewEvaluationPage = memo(
    ({
        evalType,
        name,
        description,
        id,
    }: {
        evalType: "auto" | "human"
        name: string
        description: string
        id: string
    }) => {
        return evalType === "auto" ? (
            <AutoEvalRunDetails
                name={name as string}
                description={description}
                id={id}
                isLoading={false}
            />
        ) : (
            <EvalRunDetails description={description} name={name as string} id={id} />
        )
    },
)

const LoadingState = ({
    evalType,
    name,
    description,
    id,
}: {
    evalType: "auto" | "human"
    name: string
    description: string
    id: string
}) => {
    return evalType === "auto" ? (
        <AutoEvalRunDetails name={name as string} description={description} id={id} isLoading />
    ) : (
        <div className="w-full h-[calc(100dvh-70px)] flex items-center justify-center">
            <div className="flex gap-2 items-center justify-center">
                <Spin spinning={true} />
                <Typography.Text className="text-[16px] leading-[18px] font-[600]">
                    Loading...
                </Typography.Text>
            </div>
        </div>
    )
}

const EvaluationPage = memo(({evalType, runId}: {evalType: "auto" | "human"; runId: string}) => {
    const rootStore = getDefaultStore()
    const breadcrumbs = useAtomValue(breadcrumbAtom, {store: rootStore})
    const appendBreadcrumb = useSetAtom(appendBreadcrumbAtom, {store: rootStore})
    const setEvalType = useSetAtom(setEvalTypeAtom)
    const appId = useAppId()

    const {isPreview, name, description, id} = useAtomValue(
        selectAtom(
            evaluationRunStateFamily(runId!),
            useCallback((v) => {
                return {
                    isPreview: v.isPreview,
                    name: v.enrichedRun?.name,
                    description: v.enrichedRun?.description,
                    id: v.enrichedRun?.id,
                }
            }, []),
            deepEqual,
        ),
    )

    useEffect(() => {
        setEvalType(evalType)
    }, [evalType])

    useEffect(() => {
        // Try loaded name first; fallback to name in URL (when present as /results/:id/:name).
        const base = (typeof window !== "undefined" ? window.location.pathname : "") || ""
        const segs = base.split("/").filter(Boolean)
        const resultsIdx = segs.findIndex((s) => s === "results")
        const urlName =
            resultsIdx !== -1 && segs[resultsIdx + 2] && !isUuid(segs[resultsIdx + 2])
                ? segs[resultsIdx + 2]
                : undefined

        const label = name || urlName
        if (!id || !label) return

        const existing = (breadcrumbs && (breadcrumbs["eval-detail"] as any)) || null
        const currentLabel: string | undefined = existing?.label
        if (currentLabel === label) return

        appendBreadcrumb({
            "eval-detail": {
                label,
                value: id as string,
            },
        })
    }, [appendBreadcrumb, breadcrumbs, id, name])

    useEffect(() => {
        const base = (typeof window !== "undefined" ? window.location.pathname : "") || ""
        const segs = base.split("/").filter(Boolean)
        const desiredLabel = evalType === "auto" ? "auto evaluation" : "human annotation"

        const appsIdx = segs.findIndex((s) => s === "apps")
        if (appsIdx !== -1) {
            const appId = segs[appsIdx + 1]
            if (!appId) return
            const evaluationsHref = `/${segs.slice(0, appsIdx + 2).join("/")}/evaluations`

            const current = (rootStore.get(breadcrumbAtom) as any) || {}
            const appPage = current["appPage"] as any
            const needsHref = !appPage || !appPage.href || !appPage.href.endsWith("/evaluations")
            const needsLabel = !appPage || appPage.label !== desiredLabel
            if (!needsHref && !needsLabel) return

            rootStore.set(appendBreadcrumbAtom, {
                appPage: {
                    ...(appPage || {}),
                    label: desiredLabel,
                    href: evaluationsHref,
                },
            })
            return
        }

        const evaluationsIdx = segs.findIndex((s) => s === "evaluations")
        if (evaluationsIdx === -1) return
        const evaluationsHref = `/${segs.slice(0, evaluationsIdx + 1).join("/")}`

        const current = (rootStore.get(breadcrumbAtom) as any) || {}
        const projectPage = current["projectPage"] as any
        const needsHref = !projectPage || projectPage.href !== evaluationsHref
        const needsLabel = !projectPage || projectPage.label !== desiredLabel
        if (!needsHref && !needsLabel) return

        rootStore.set(appendBreadcrumbAtom, {
            projectPage: {
                ...(projectPage || {}),
                label: desiredLabel,
                href: evaluationsHref,
            },
        })
    }, [rootStore, appendBreadcrumb, evalType])

    // Clean up eval-detail crumb when leaving the page to avoid stale breadcrumbs
    useEffect(() => {
        return () => {
            const current = (rootStore.get(breadcrumbAtom) as any) || {}
            if (current["eval-detail"]) {
                const {"eval-detail": _omit, ...rest} = current
                rootStore.set(setBreadcrumbsAtom, rest)
            }
        }
    }, [rootStore])

    const hasPreviewData = Boolean(id)

    if (isPreview && !hasPreviewData) {
        return (
            <ErrorState
                title="Evaluation data unavailable"
                subtitle="We couldn't load this evaluation run. Please try again later or relaunch the evaluation."
                status="warning"
                onRetry={() => router.reload()}
            />
        )
    }

    return (
        <div
            className={clsx([
                "evaluationContainer human-eval grow",
                {"flex flex-col min-h-0": isPreview},
            ])}
        >
            {/** TODO: improve the component state specially AutoEvalRunDetails */}
            {isPreview === undefined ? (
                <LoadingState
                    evalType={evalType}
                    name={name as string}
                    description={description}
                    id={runId}
                />
            ) : isPreview && id ? (
                <>
                    <UrlSync evalType={evalType} />
                    <PreviewEvaluationPage
                        evalType={evalType}
                        name={name as string}
                        description={description}
                        id={runId}
                        runId={runId}
                        isLoading={false}
                    />
                </>
            ) : (
                <LegacyEvaluationPage id={id} />
            )}
        </div>
    )
})

const EvalRunDetailsPage = memo(({evalType}: {evalType: "auto" | "human"}) => {
    const router = useRouter()
    const runId = router.query.evaluation_id ? router.query.evaluation_id.toString() : ""
    return (
        <RunIdProvider runId={runId as string}>
            <EvaluationPageData runId={runId} />
            <EvaluationPage evalType={evalType} runId={runId} />
            <ComparisonDataFetcher />
        </RunIdProvider>
    )
})

export default memo(EvalRunDetailsPage)

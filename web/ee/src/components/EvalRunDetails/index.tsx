import {memo, useCallback, useEffect} from "react"

import {Spin, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {getDefaultStore, useAtom, useAtomValue, useSetAtom} from "jotai"
import {selectAtom} from "jotai/utils"
import {useRouter} from "next/router"

import ErrorState from "@/oss/components/ErrorState"
import EvalRunDetails from "@/oss/components/EvalRunDetails/HumanEvalRun"
import SingleModelEvaluationTable from "@/oss/components/EvaluationTable/SingleModelEvaluationTable"
import {RunIdProvider} from "@/oss/contexts/RunIdContext"
import {appendBreadcrumbAtom, breadcrumbAtom, setBreadcrumbsAtom} from "@/oss/lib/atoms/breadcrumb"
import {isUuid} from "@/oss/lib/helpers/utils"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"
import {
    evaluationRunStateFamily,
    initializeRun,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {_EvaluationScenario, Evaluation} from "@/oss/lib/Types"
import {abortAll} from "@/oss/lib/utils/abortControllers"

import EvaluationScenarios from "../pages/evaluations/evaluationScenarios/EvaluationScenarios"

import AutoEvalRunDetails from "./AutoEvalRun"
import {ComparisonDataFetcher} from "./components/ComparisonDataFetcher"
import OnlineEvalRunDetails from "./OnlineEvalRun"
import OnlineUrlSync from "./OnlineEvalRun/OnlineUrlSync"
import {evalTypeAtom, setEvalTypeAtom} from "./state/evalType"
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
        evalType === "auto" || evalType === "custom" ? (
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
        evalType: "auto" | "human" | "online" | "custom"
        name: string
        description: string
        id: string
    }) => {
        return evalType === "auto" || evalType === "custom" ? (
            <AutoEvalRunDetails name={name} description={description} id={id} isLoading={false} />
        ) : evalType === "online" ? (
            <OnlineEvalRunDetails name={name} description={description} id={id} />
        ) : (
            <EvalRunDetails description={description} name={name} id={id} />
        )
    },
)

const LoadingState = ({
    evalType,
    name,
    description,
    id,
}: {
    evalType: "auto" | "human" | "online" | "custom"
    name: string
    description: string
    id: string
}) => {
    return evalType === "auto" || evalType === "custom" ? (
        <AutoEvalRunDetails name={name} description={description} id={id} isLoading />
    ) : evalType === "online" ? (
        <OnlineEvalRunDetails name={name} description={description} id={id} isLoading />
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

const EvaluationPage = memo(
    ({evalType, runId}: {evalType: "auto" | "human" | "online" | "custom"; runId: string}) => {
        const rootStore = getDefaultStore()
        const breadcrumbs = useAtomValue(breadcrumbAtom, {store: rootStore})
        const appendBreadcrumb = useSetAtom(appendBreadcrumbAtom, {store: rootStore})

        const router = useRouter()

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
            const desiredLabel =
                evalType === "online"
                    ? "online evaluation"
                    : evalType === "human"
                      ? "human annotation"
                      : evalType === "custom"
                        ? "custom evaluation"
                        : "auto evaluation"

            const appsIdx = segs.findIndex((s) => s === "apps")
            if (appsIdx !== -1) {
                const appId = segs[appsIdx + 1]
                if (!appId) return
                const evaluationsHref = `/${segs.slice(0, appsIdx + 2).join("/")}/evaluations`

                const current = (rootStore.get(breadcrumbAtom) as any) || {}
                const appPage = current["appPage"] as any
                const needsHref =
                    !appPage || !appPage.href || !appPage.href.endsWith("/evaluations")
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
                        name={(name as string) || ""}
                        description={(description as string) || ""}
                        id={runId}
                    />
                ) : isPreview && id ? (
                    <>
                        {evalType === "online" ? (
                            <OnlineUrlSync />
                        ) : (
                            <UrlSync evalType={evalType} />
                        )}
                        <PreviewEvaluationPage
                            evalType={evalType}
                            name={(name as string) || ""}
                            description={(description as string) || ""}
                            id={runId}
                        />
                    </>
                ) : (
                    <LegacyEvaluationPage id={id} />
                )}
            </div>
        )
    },
)

const EvalRunDetailsPage = memo(
    ({evalType: propsEvalType}: {evalType: "auto" | "human" | "online" | "custom"}) => {
        const router = useRouter()
        const runIdParam = router.query.evaluation_id
        const runId =
            typeof runIdParam === "string"
                ? runIdParam
                : Array.isArray(runIdParam)
                  ? runIdParam[0]
                  : null
        const setEvalType = useSetAtom(setEvalTypeAtom)
        const evalType = useAtomValue(evalTypeAtom)

        useEffect(() => {
            setEvalType(propsEvalType)

            return () => {
                setEvalType(null)
            }
        }, [propsEvalType])

        return (
            <RunIdProvider runId={runId}>
                {evalType && runId ? (
                    <>
                        <EvaluationPageData runId={runId} />
                        <EvaluationPage evalType={evalType} runId={runId} />
                        <ComparisonDataFetcher />
                    </>
                ) : null}
            </RunIdProvider>
        )
    },
)

export default memo(EvalRunDetailsPage)

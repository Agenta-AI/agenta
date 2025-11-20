import {memo, useCallback, useEffect, useMemo} from "react"

import {Spin, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {createStore, Provider, useAtomValue} from "jotai"
import {selectAtom} from "jotai/utils"
import {useRouter} from "next/router"

import EvalRunDetails from "@/oss/components/EvalRunDetails/HumanEvalRun"
import SingleModelEvaluationTable from "@/oss/components/EvaluationTable/SingleModelEvaluationTable"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"
import {
    evaluationRunStateAtom,
    jotaiStoreCache,
    setActiveStoreKey,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {initialState} from "@/oss/lib/hooks/useEvaluationRunData/assets/constants"
import {_EvaluationScenario, Evaluation} from "@/oss/lib/Types"
import {abortAll} from "@/oss/lib/utils/abortControllers"

import EvaluationScenarios from "../pages/evaluations/evaluationScenarios/EvaluationScenarios"

import AutoEvalRunDetails from "./AutoEvalRun"
import {evalTypeAtom} from "./state/evalType"
import UrlSync from "./UrlSync"

const EvaluationPageData = memo(({children}: {children?: React.ReactNode}) => {
    const router = useRouter()
    const runId = router.query.evaluation_id ? router.query.evaluation_id.toString() : ""

    // Abort any in-flight data requests when navigating away
    useEffect(() => {
        return () => {
            abortAll()
        }
    }, [router.pathname])

    useEvaluationRunData(runId || null, true)
    return children
})

const LegacyEvaluationPage = ({id: evaluationTableId}) => {
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
            <AutoEvalRunDetails name={name as string} description={description} id={id} />
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

const EvaluationPage = memo(({evalType}: {evalType: "auto" | "human"}) => {
    const {isPreview, name, description, id} = useAtomValue(
        selectAtom(
            evaluationRunStateAtom,
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

    return (
        <div
            className={clsx([
                "evaluationContainer human-eval grow",
                {"flex flex-col min-h-0": isPreview},
            ])}
        >
            {/** TODO: improve the component state specially AutoEvalRunDetails */}
            {isPreview === undefined ? (
                <LoadingState />
            ) : isPreview && id ? (
                <>
                    <UrlSync evalType={evalType} />
                    <PreviewEvaluationPage
                        evalType={evalType}
                        name={name as string}
                        description={description}
                        id={id}
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
    // One isolated Jotai store per evaluation run tab to prevent cross-tab overload
    const store = useMemo(() => {
        if (!runId) {
            const s = createStore()
            s.set(evalTypeAtom, evalType)
            return s // fallback for missing runId
        }
        setActiveStoreKey(runId)
        if (jotaiStoreCache.has(runId)) {
            const s = jotaiStoreCache.get(runId)!
            s.set(evalTypeAtom, evalType)
            return s
        } else {
            const s = createStore()
            s.set(evaluationRunStateAtom, initialState)
            s.set(evalTypeAtom, evalType)
            jotaiStoreCache.set(runId, s)
            return s
        }
    }, [runId, evalType])
    return (
        <Provider store={store}>
            <EvaluationPageData />
            <EvaluationPage evalType={evalType} />
        </Provider>
    )
})

export default memo(EvalRunDetailsPage)

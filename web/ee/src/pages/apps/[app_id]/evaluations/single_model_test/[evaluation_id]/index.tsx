import {memo, useCallback, useEffect, useMemo} from "react"

import {Spin, Typography} from "antd"
import clsx from "clsx"
import deepEqual from "fast-deep-equal"
import {Provider, useAtomValue, useSetAtom, createStore} from "jotai"
import {selectAtom} from "jotai/utils"
import {useRouter} from "next/router"

import EvalRunDetails from "@/oss/components/EvalRunDetails"
import SingleModelEvaluationTable from "@/oss/components/EvaluationTable/SingleModelEvaluationTable"
import useEvaluationRunData from "@/oss/lib/hooks/useEvaluationRunData"
import {
    evaluationRunStateAtom,
    jotaiStoreCache,
    setActiveStoreKey,
} from "@/oss/lib/hooks/useEvaluationRunData/assets/atoms"
import {initialState} from "@/oss/lib/hooks/useEvaluationRunData/assets/constants"
import {abortAll} from "@/oss/lib/utils/abortControllers"

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

const LegacyEvaluationPage = () => {
    const router = useRouter()
    const evaluationTableId = router.query.evaluation_id
        ? router.query.evaluation_id.toString()
        : ""

    const {legacyEvaluationSWR, legacyScenariosSWR} = useEvaluationRunData(
        evaluationTableId || null,
        true,
    )

    const data = legacyEvaluationSWR.data

    return data ? (
        <SingleModelEvaluationTable
            evaluationScenarios={legacyScenariosSWR.data as any[]}
            evaluation={data}
            isLoading={legacyEvaluationSWR.isLoading || legacyScenariosSWR.isLoading}
        />
    ) : null
}

const EvaluationPage = memo(() => {
    const {isPreview, name, description, id} = useAtomValue(
        selectAtom(
            evaluationRunStateAtom,
            useCallback((v) => {
                return {
                    hasEnrichedRun: !!v.enrichedRun,
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
                {
                    "flex flex-col min-h-0": isPreview,
                },
            ])}
        >
            {isPreview === undefined ? (
                // {isPreview && !hasEnrichedRun ? (
                <div className="w-full h-[calc(100dvh-70px)] flex items-center justify-center">
                    <div className="flex gap-2 items-center justify-center">
                        <Spin spinning={true} />
                        <Typography.Text className="text-[16px] leading-[18px] font-[600]">
                            Loading...
                        </Typography.Text>
                    </div>
                </div>
            ) : isPreview && id ? (
                <EvalRunDetails description={description} name={name as string} id={id} />
            ) : (
                <LegacyEvaluationPage />
            )}
        </div>
    )
})

const EvaluationPageWrapper = memo(() => {
    const router = useRouter()
    const runId = router.query.evaluation_id ? router.query.evaluation_id.toString() : ""
    // One isolated Jotai store per evaluation run tab to prevent cross-tab overload
    const store = useMemo(() => {
        if (!runId) return createStore() // fallback for missing runId
        setActiveStoreKey(runId)
        if (jotaiStoreCache.has(runId)) {
            return jotaiStoreCache.get(runId)!
        } else {
            const s = createStore()
            s.set(evaluationRunStateAtom, initialState)
            jotaiStoreCache.set(runId, s)
            return s
        }
    }, [runId])
    return (
        <Provider store={store}>
            <EvaluationPageData />
            <EvaluationPage />
        </Provider>
    )
})

export default memo(EvaluationPageWrapper)

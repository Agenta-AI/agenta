import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowLeftOutlined} from "@ant-design/icons"
import {Button, Result} from "antd"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"
import {useLocalStorage} from "usehooks-ts"

import {message} from "@/oss/components/AppMessageContext"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {groupVariantsByParent} from "@/oss/lib/helpers/variantHelper"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import useStatelessVariants from "@/oss/lib/hooks/useStatelessVariants"
import {Evaluator, EvaluatorConfig, Variant, testset} from "@/oss/lib/Types"
import {evaluatorByKeyAtomFamily} from "@/oss/state/evaluators"
import {useTestsetsData} from "@/oss/state/testset"

import ConfigureEvaluatorSkeleton from "./assets/ConfigureEvaluatorSkeleton"

const ConfigureEvaluator = dynamic(
    () =>
        import(
            "@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator"
        ),
    {ssr: false},
)

const ConfigureEvaluatorPage = ({evaluatorId}: {evaluatorId?: string | null}) => {
    const router = useRouter()
    const {projectURL} = useURL()
    const {
        evaluatorsSwr,
        evaluatorConfigsSwr,
        isLoadingEvaluators,
        isLoadingEvaluatorConfigs,
        refetchAll,
    } = useFetchEvaluatorsData()
    const evaluators = evaluatorsSwr.data || []
    const evaluatorConfigs = evaluatorConfigsSwr.data || []

    const existingConfig = useMemo(() => {
        if (!evaluatorId) return null
        return evaluatorConfigs.find((config) => config.id === evaluatorId) ?? null
    }, [evaluatorConfigs, evaluatorId])

    const evaluatorKey = existingConfig?.evaluator_key ?? evaluatorId ?? null

    const evaluatorQuery = useAtomValue(evaluatorByKeyAtomFamily(evaluatorKey))
    const evaluatorFromRegular = evaluators.find((item) => item.key === evaluatorKey)
    const evaluator = evaluatorFromRegular ?? evaluatorQuery.data ?? null
    const isLoadingEvaluatorByKey = evaluatorQuery.isPending && !evaluatorFromRegular

    const {testsets} = useTestsetsData()
    const {variants: variantData} = useStatelessVariants({lightLoading: true})
    const variants = useMemo(() => groupVariantsByParent(variantData, true), [variantData])
    const appId = useAppId()
    const [debugEvaluator, setDebugEvaluator] = useLocalStorage("isDebugSelectionOpen", false)
    const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null)
    const [selectedTestcase, setSelectedTestcase] = useState<{
        testcase: Record<string, any> | null
    }>({
        testcase: null,
    })
    const [editMode, setEditMode] = useState(false)
    const [cloneConfig, setCloneConfig] = useState(false)
    const [editEvalEditValues, setEditEvalEditValues] = useState<EvaluatorConfig | null>(null)
    const [selectedTestset, setSelectedTestset] = useState("")

    useEffect(() => {
        if (existingConfig) {
            setEditMode(true)
            setEditEvalEditValues(existingConfig)
            setCloneConfig(false)
        } else {
            setEditMode(false)
            setEditEvalEditValues(null)
            setCloneConfig(false)
        }
    }, [existingConfig])

    const isLoading = isLoadingEvaluators || isLoadingEvaluatorConfigs || isLoadingEvaluatorByKey

    useEffect(() => {
        if (testsets?.length) {
            setSelectedTestset(testsets[0]._id)
        }
    }, [testsets])

    useEffect(() => {
        if (variants?.length) {
            setSelectedVariant((current) => current ?? variants[0])
        }
    }, [variants])

    const navigateBack = useCallback(() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back()
            return
        }
        router.push(`${projectURL}/evaluators`)
    }, [projectURL, router])

    const handleSuccess = useCallback(async () => {
        message.success("Evaluator configuration saved")
        await refetchAll()
    }, [refetchAll])

    if (!router.isReady || isLoading) {
        return <ConfigureEvaluatorSkeleton />
    }

    if (!evaluator) {
        const notFoundTitle = existingConfig
            ? "Evaluator template not found"
            : "Evaluator not found"
        const notFoundSubtitle = existingConfig
            ? "We could not find the template associated with this evaluator configuration."
            : "We could not find the requested evaluator template."

        return (
            <Result
                status="404"
                title={notFoundTitle}
                subTitle={notFoundSubtitle}
                extra={
                    <Button type="primary" icon={<ArrowLeftOutlined />} onClick={navigateBack}>
                        Back to Evaluators
                    </Button>
                }
            />
        )
    }

    if (existingConfig && (!editEvalEditValues || !editMode)) {
        return <ConfigureEvaluatorSkeleton />
    }

    const setCurrent: React.Dispatch<React.SetStateAction<number>> = () => {
        navigateBack()
    }

    const handleOnCancel = () => {
        navigateBack()
    }

    return (
        <ConfigureEvaluator
            selectedEvaluator={evaluator as Evaluator}
            setCurrent={setCurrent}
            handleOnCancel={handleOnCancel}
            variants={(variants as Variant[]) || []}
            testsets={(testsets as testset[]) || []}
            onSuccess={handleSuccess}
            selectedTestcase={selectedTestcase}
            selectedVariant={selectedVariant}
            setSelectedVariant={setSelectedVariant}
            editMode={editMode}
            editEvalEditValues={editEvalEditValues}
            setEditEvalEditValues={setEditEvalEditValues}
            setEditMode={setEditMode}
            cloneConfig={cloneConfig}
            setCloneConfig={setCloneConfig}
            setSelectedTestcase={setSelectedTestcase}
            setDebugEvaluator={setDebugEvaluator}
            debugEvaluator={debugEvaluator}
            selectedTestset={selectedTestset}
            setSelectedTestset={setSelectedTestset}
            appId={appId}
        />
    )
}

export default ConfigureEvaluatorPage

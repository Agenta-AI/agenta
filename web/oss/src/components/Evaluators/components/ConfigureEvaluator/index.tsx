import {useCallback, useEffect, useMemo, useState} from "react"

import {ArrowLeftOutlined} from "@ant-design/icons"
import {Button, Result} from "antd"
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
import {fetchAllEvaluators} from "@/oss/services/evaluators"
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

    const [archivedEvaluators, setArchivedEvaluators] = useState<Evaluator[]>([])

    // Fetch archived evaluators if evaluator not found in regular list
    useEffect(() => {
        if (!evaluatorKey || evaluators.find((item) => item.key === evaluatorKey)) {
            return
        }

        // Evaluator not found, fetch all including archived
        fetchAllEvaluators(true)
            .then((allEvaluators) => {
                setArchivedEvaluators(allEvaluators)
            })
            .catch((error) => {
                console.error("Failed to fetch archived evaluators:", error)
            })
    }, [evaluatorKey, evaluators])

    const evaluator = useMemo(() => {
        if (!evaluatorKey) return null
        return (
            evaluators.find((item) => item.key === evaluatorKey) ??
            archivedEvaluators.find((item) => item.key === evaluatorKey) ??
            null
        )
    }, [evaluators, archivedEvaluators, evaluatorKey])

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

    const isLoading = isLoadingEvaluators || isLoadingEvaluatorConfigs

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

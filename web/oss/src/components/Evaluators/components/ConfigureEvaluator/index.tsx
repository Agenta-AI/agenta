/**
 * ConfigureEvaluatorPage - Standalone evaluator configuration page
 *
 * This is the page wrapper for the evaluator configuration playground.
 * It handles:
 * - Loading evaluator data from the URL
 * - Initializing playground atoms with the correct evaluator/mode
 * - Cleaning up atoms when leaving the page
 *
 * The actual UI is rendered by ConfigureEvaluator which reads from atoms.
 * DebugSection handles its own data fetching for variants and testsets.
 */
import {useCallback, useEffect, useMemo} from "react"

import {message} from "@agenta/ui/app-message"
import {ArrowLeftOutlined} from "@ant-design/icons"
import {Button, Result} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {
    initPlaygroundAtom,
    playgroundEditValuesAtom,
    resetPlaygroundAtom,
} from "@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator/state/atoms"
import useURL from "@/oss/hooks/useURL"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {Evaluator} from "@/oss/lib/Types"
import {evaluatorByKeyAtomFamily} from "@/oss/state/evaluators"

import ConfigureEvaluatorSkeleton from "./assets/ConfigureEvaluatorSkeleton"

const ConfigureEvaluator = dynamic(
    () =>
        import("@/oss/components/pages/evaluations/autoEvaluation/EvaluatorsModal/ConfigureEvaluator"),
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

    // Atom actions
    const initPlayground = useSetAtom(initPlaygroundAtom)
    const resetPlayground = useSetAtom(resetPlaygroundAtom)
    const stagedConfig = useAtomValue(playgroundEditValuesAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const existingConfig = useMemo(() => {
        if (!evaluatorId) return null
        return (
            evaluatorConfigs.find((config) => config.id === evaluatorId) ??
            (stagedConfig?.id === evaluatorId ? stagedConfig : null)
        )
    }, [evaluatorConfigs, evaluatorId, stagedConfig])

    const evaluatorKey = resolveEvaluatorKey(existingConfig) ?? evaluatorId ?? null

    const evaluatorQuery = useAtomValue(evaluatorByKeyAtomFamily(evaluatorKey))
    const evaluatorFromRegular = evaluators.find((item) => item.key === evaluatorKey)
    const evaluator = evaluatorFromRegular ?? evaluatorQuery.data ?? null
    const isLoadingEvaluatorByKey = evaluatorQuery.isPending && !evaluatorFromRegular

    const isLoading = isLoadingEvaluators || isLoadingEvaluatorConfigs || isLoadingEvaluatorByKey

    // Initialize playground atoms when evaluator data is ready
    useEffect(() => {
        if (!evaluator || isLoading) return

        // Determine mode based on whether we have an existing config
        const mode = existingConfig ? "edit" : "create"

        initPlayground({
            evaluator: evaluator as Evaluator,
            existingConfig: existingConfig ?? undefined,
            mode,
        })
    }, [evaluator, existingConfig, isLoading, initPlayground])

    // Cleanup atoms when leaving the page
    useEffect(() => {
        return () => {
            resetPlayground()
        }
    }, [resetPlayground])

    const navigateBack = useCallback(() => {
        if (typeof window !== "undefined" && window.history.length > 1) {
            router.back()
            return
        }
        router.push(`${projectURL}/evaluators`)
    }, [projectURL, router])

    const handleSuccess = useCallback(async () => {
        message.success("Evaluator configuration saved")
        recordWidgetEvent("evaluator_created")
        await refetchAll()
    }, [recordWidgetEvent, refetchAll])

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

    return <ConfigureEvaluator onClose={navigateBack} onSuccess={handleSuccess} />
}

export default ConfigureEvaluatorPage

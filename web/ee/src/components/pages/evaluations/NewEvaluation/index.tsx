import {useCallback, memo, useEffect, useState, useMemo, useRef} from "react"

import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Button} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useAppId} from "@/oss/hooks/useAppId"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {LLMRunRateLimit} from "@/oss/lib/Types"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {fetchTestset, useTestsets} from "@/oss/services/testsets/api"

import {useStyles} from "./assets/styles"
import type {NewEvaluationModalGenericProps} from "./types"

const NewEvaluationModalContent = dynamic(() => import("./Components/NewEvaluationModalContent"), {
    ssr: false,
})

const AdvancedSettingsPopover = dynamic(() => import("./Components/AdvancedSettingsPopover"), {
    ssr: false,
})

const NewEvaluationModal = <Preview extends boolean = true>({
    onSuccess,
    preview = false as Preview,
    evaluationType,
    ...props
}: NewEvaluationModalGenericProps<Preview>) => {
    const classes = useStyles()
    const appId = useAppId()
    const router = useRouter()

    // Fetch evaluation data
    const evaluationData = useFetchEvaluatorsData({preview})

    // Use useMemo to derive evaluators, evaluatorConfigs, and loading flags based on preview flag
    const {evaluators, evaluatorConfigs, loadingEvaluators, loadingEvaluatorConfigs} =
        useMemo(() => {
            if (preview) {
                return {
                    evaluators: evaluationData.evaluatorsSwr?.data || [],
                    evaluatorConfigs: [],
                    loadingEvaluators: evaluationData.evaluatorsSwr?.isLoading ?? false,
                    loadingEvaluatorConfigs: false,
                }
            } else {
                return {
                    evaluators: [],
                    evaluatorConfigs: evaluationData.evaluatorConfigsSwr?.data || [],
                    loadingEvaluators: false,
                    loadingEvaluatorConfigs: evaluationData.evaluatorConfigsSwr?.isLoading ?? false,
                }
            }
        }, [
            preview,
            evaluationData.evaluatorsSwr?.data,
            evaluationData.evaluatorsSwr?.isLoading,
            evaluationData.evaluatorConfigsSwr?.data,
            evaluationData.evaluatorConfigsSwr?.isLoading,
        ])

    const [submitLoading, setSubmitLoading] = useState(false)
    const [selectedTestsetId, setSelectedTestsetId] = useState("")
    const [selectedVariantRevisionIds, setSelectedVariantRevisionIds] = useState<string[]>([])
    const [selectedEvalConfigs, setSelectedEvalConfigs] = useState<string[]>([])

    //@ts-ignore
    const {data} = useVariants()()

    const {createNewRun: createPreviewEvaluationRun} = usePreviewEvaluations()
    const {data: testsets} = useTestsets()

    const {secrets} = useVaultSecret()

    const [activePanel, setActivePanel] = useState<string | null>("testsetPanel")
    const [evaluationName, setEvaluationName] = useState("")
    const [nameFocused, setNameFocused] = useState(false)

    const handlePanelChange = useCallback((key: string | string[]) => {
        setActivePanel(key as string)
    }, [])

    useEffect(() => {
        if (props.open) {
            setEvaluationName("")
            setSelectedEvalConfigs([])
            setSelectedTestsetId("")
            setSelectedVariantRevisionIds([])
            setActivePanel("testsetPanel")
        }
    }, [props.open, appId])

    // Track focus on any input within modal to avoid overriding user typing
    useEffect(() => {
        function handleFocusIn(e: FocusEvent) {
            if ((e.target as HTMLElement).tagName === "INPUT") {
                setNameFocused(true)
            }
        }
        function handleFocusOut(e: FocusEvent) {
            if ((e.target as HTMLElement).tagName === "INPUT") {
                setNameFocused(false)
            }
        }
        document.addEventListener("focusin", handleFocusIn)
        document.addEventListener("focusout", handleFocusOut)
        return () => {
            document.removeEventListener("focusin", handleFocusIn)
            document.removeEventListener("focusout", handleFocusOut)
        }
    }, [])

    // Memoised base (deterministic) part of generated name (without random suffix)
    const generatedNameBase = useMemo(() => {
        if (!selectedVariantRevisionIds.length || !selectedTestsetId) return ""
        const variant = data?.variants?.find((v) => selectedVariantRevisionIds.includes(v.id))
        const testset = testsets?.find((ts) => ts._id === selectedTestsetId)
        if (!variant || !testset) return ""
        return `${variant.variantName}-v${variant.revision}-${testset.name}`
    }, [selectedVariantRevisionIds, selectedTestsetId, data?.variants, testsets])

    // Auto-generate / update evaluation name intelligently to avoid loops
    const lastAutoNameRef = useRef<string>("")
    const lastBaseRef = useRef<string>("")
    useEffect(() => {
        if (evaluationType !== "human") return
        if (!generatedNameBase) return
        if (nameFocused) return // user typing

        // When base (variant/testset) changed → generate new suggestion
        if (generatedNameBase !== lastBaseRef.current) {
            const randomWord = Math.random().toString(36).substring(2, 7)
            const newName = `${generatedNameBase}-${randomWord}`
            const shouldUpdate = !evaluationName || evaluationName === lastAutoNameRef.current
            lastBaseRef.current = generatedNameBase
            lastAutoNameRef.current = newName
            if (shouldUpdate) {
                setEvaluationName(newName)
            }
            return
        }

        // If user cleared the field (blur) -> restore auto-name
        if (!evaluationName) {
            setEvaluationName(lastAutoNameRef.current)
        }
    }, [generatedNameBase, evaluationName, nameFocused, evaluationType])

    const [rateLimitValues, setRateLimitValues] = useState<LLMRunRateLimit>({
        batch_size: 10,
        max_retries: 3,
        retry_delay: 3,
        delay_between_batches: 5,
    })
    const [correctAnswerColumn, setCorrectAnswerColumn] = useState<string>("correct_answer")

    const validateSubmission = useCallback(async () => {
        if (evaluationType === "human" && !evaluationName) {
            message.error("Please enter evaluation name")
            return false
        }
        if (!selectedTestsetId) {
            message.error("Please select a test set")
            return false
        }
        if (selectedVariantRevisionIds.length === 0) {
            message.error("Please select app variant")
            return false
        }
        if (selectedEvalConfigs.length === 0) {
            message.error("Please select evaluator configuration")
            return false
        }
        if (
            !preview &&
            selectedEvalConfigs.some(
                (id) =>
                    evaluatorConfigs.find((config) => config.id === id)?.evaluator_key ===
                    "auto_ai_critique",
            ) &&
            (await redirectIfNoLLMKeys({secrets}))
        ) {
            message.error("LLM keys are required for AI Critique configuration")
            return false
        }

        // Validate variant
        if (selectedVariantRevisionIds.length > 0) {
            const revisions = data?.variants?.filter((rev) =>
                selectedVariantRevisionIds.includes(rev.id),
            )
            if (!revisions?.length) {
                message.error("Please select variant")
                return false
            }
            const variantInputs = revisions.map((rev) => ({
                inputParams: rev.inputParams,
                variantName: rev.variantName,
            }))

            const testset = await fetchTestset(selectedTestsetId)
            if (!testset) {
                message.error("Please select a test set")
                return false
            }
            const testsetColumns = Object.keys(testset?.csvdata[0] || {})

            if (!testsetColumns.length) {
                message.error("Please select a correct testset which has test cases")
                return false
            }
            const isInputParamsAndTestsetColumnsMatch = variantInputs.every((input) => {
                const inputParams = input.inputParams
                return inputParams.some((param) => testsetColumns.includes(param.name))
            })

            if (!isInputParamsAndTestsetColumnsMatch) {
                message.error(
                    "The testset columns do not match the selected variant input parameters",
                )
                return false
            }
        }
        return true
    }, [
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        evaluatorConfigs,
        secrets,
        preview,
        evaluationName,
    ])

    const onSubmit = useCallback(async () => {
        setSubmitLoading(true)
        try {
            if (!(await validateSubmission())) return

            const revisions = data?.variants

            // Narrow evalDataSource with runtime guards for correct typing
            let evalDataSource: typeof evaluatorConfigs | typeof evaluators
            if (preview) {
                evalDataSource = evaluators

                const selectionData = {
                    name: evaluationName,
                    revisions: revisions
                        ?.filter((rev) => selectedVariantRevisionIds.includes(rev.id))
                        .filter(Boolean),
                    testset: testsets?.find((testset) => testset._id === selectedTestsetId),
                    evaluators: selectedEvalConfigs
                        .map((id) =>
                            (evalDataSource || []).find((config) => {
                                return config.id === id
                            }),
                        )
                        .filter(Boolean),
                    rate_limit: rateLimitValues,
                    correctAnswerColumn,
                }

                if (
                    !selectionData.revisions?.length ||
                    !selectionData.testset ||
                    !selectionData.evaluators?.length ||
                    (evaluationType === "human" && !evaluationName)
                ) {
                    message.error(
                        `Please select a test set, app variant, ${evaluationType === "human" ? "evaluation name, and" : " and"} evaluator configuration. Missing: ${
                            !selectionData.revisions?.length ? "app revision" : ""
                        } ${!selectionData.testset ? "test set" : ""} ${
                            !selectionData.evaluators?.length
                                ? "evaluators"
                                : evaluationType === "human" && !evaluationName
                                  ? "evaluation name"
                                  : ""
                        }`,
                    )
                    setSubmitLoading(false)
                    return
                } else {
                    const data = await createPreviewEvaluationRun(structuredClone(selectionData))

                    const runId = data.run.runs[0].id
                    router.push(`/apps/${appId}/evaluations/single_model_test/${runId}`)
                }
            } else {
                createEvaluation(appId, {
                    testset_id: selectedTestsetId,
                    revisions_ids: selectedVariantRevisionIds,
                    evaluators_configs: selectedEvalConfigs,
                    rate_limit: rateLimitValues,
                    correct_answer_column: correctAnswerColumn,
                })
                    .then(onSuccess)
                    .catch(console.error)
                    .finally(() => setSubmitLoading(false))
            }
        } catch (error) {
            console.error(error)
            setSubmitLoading(false)
        } finally {
            setSubmitLoading(false)
        }

        return
    }, [
        appId,
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        rateLimitValues,
        evaluatorConfigs,
        correctAnswerColumn,
        evaluationName,
        data?.variants,
        testsets,
        evaluators,
        evaluatorConfigs,
        preview,
        validateSubmission,
    ])

    return (
        <EnhancedModal
            title={
                <div className="w-full flex items-center justify-between">
                    <div>
                        <span>New {evaluationType === "auto" ? "Auto" : "Human"} Evaluation</span>
                    </div>
                    <div className="flex items-center justify-center gap-2">
                        {evaluationType === "auto" ? (
                            <AdvancedSettingsPopover
                                correctAnswerColumn={correctAnswerColumn}
                                setCorrectAnswerColumn={setCorrectAnswerColumn}
                                setRateLimitValues={setRateLimitValues}
                                rateLimitValues={rateLimitValues}
                            />
                        ) : null}

                        <Button
                            type="text"
                            onClick={() => props.onCancel?.({} as any)}
                            icon={<CloseOutlined />}
                        />
                    </div>
                </div>
            }
            onOk={onSubmit}
            okText="Create"
            centered
            closeIcon={null}
            destroyOnHidden
            maskClosable={false}
            width={1200}
            className={classes.modalContainer}
            okButtonProps={{icon: <PlusOutlined />, loading: submitLoading}}
            {...props}
        >
            <NewEvaluationModalContent
                evaluationType={evaluationType}
                onSuccess={onSuccess}
                handlePanelChange={handlePanelChange}
                activePanel={activePanel}
                selectedTestsetId={selectedTestsetId}
                setSelectedTestsetId={setSelectedTestsetId}
                selectedVariantRevisionIds={selectedVariantRevisionIds}
                setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
                selectedEvalConfigs={selectedEvalConfigs}
                setSelectedEvalConfigs={setSelectedEvalConfigs}
                evaluationName={evaluationName}
                setEvaluationName={setEvaluationName}
                preview={preview}
                isLoading={loadingEvaluators || loadingEvaluatorConfigs}
                isOpen={props.open}
                testSets={testsets || []}
                variants={data?.variants}
                evaluators={evaluators}
                evaluatorConfigs={evaluatorConfigs}
            />
        </EnhancedModal>
    )
}

export default memo(NewEvaluationModal)

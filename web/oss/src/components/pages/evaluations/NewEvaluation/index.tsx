import {useCallback, memo, useEffect, useMemo, useRef, useState} from "react"

import {getDefaultStore} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {useAppId} from "@/oss/hooks/useAppId"
import useURL from "@/oss/hooks/useURL"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"
import {extractInputKeysFromSchema} from "@/oss/lib/shared/variant/inputHelpers"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {fetchTestset} from "@/oss/services/testsets/api"
import {useAppsData} from "@/oss/state/app/hooks"
import {stablePromptVariablesAtomFamily} from "@/oss/state/newPlayground/core/prompts"
import {variantFlagsAtomFamily} from "@/oss/state/newPlayground/core/variantFlags"
import {useTestsetsData} from "@/oss/state/testset"
import {appSchemaAtom, appUriInfoAtom} from "@/oss/state/variant/atoms/fetcher"

import {buildEvaluationNavigationUrl} from "../utils"

import {DEFAULT_ADVANCE_SETTINGS} from "./assets/constants"
import {useStyles} from "./assets/styles"
import type {LLMRunRateLimitWithCorrectAnswer, NewEvaluationModalGenericProps} from "./types"

const NewEvaluationModalContent = dynamic(() => import("./Components/NewEvaluationModalContent"), {
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
    const isAppScoped = Boolean(appId)
    const {apps: availableApps = []} = useAppsData()
    const [selectedAppId, setSelectedAppId] = useState<string>(appId || "")
    const appOptions = useMemo(() => {
        const options = availableApps.map((app) => ({
            label: app.app_name,
            value: app.app_id,
            type: app.app_type ?? null,
            createdAt: app.created_at ?? null,
            updatedAt: app.updated_at ?? null,
        }))
        if (selectedAppId && !options.some((opt) => opt.value === selectedAppId)) {
            options.push({
                label: selectedAppId,
                value: selectedAppId,
                type: null,
                createdAt: null,
                updatedAt: null,
            })
        }
        return options
    }, [availableApps, selectedAppId])
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()

    // Fetch evaluation data
    const evaluationData = useFetchEvaluatorsData({
        preview,
        queries: {is_human: evaluationType === "human"},
        appId: selectedAppId || "",
    })

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
    const [activePanel, setActivePanel] = useState<string | null>(
        isAppScoped ? "variantPanel" : "appPanel",
    )
    const [evaluationName, setEvaluationName] = useState("")
    const [nameFocused, setNameFocused] = useState(false)
    const [advanceSettings, setAdvanceSettings] =
        useState<LLMRunRateLimitWithCorrectAnswer>(DEFAULT_ADVANCE_SETTINGS)

    useEffect(() => {
        if (isAppScoped) {
            setSelectedAppId(appId || "")
        } else if (!props.open) {
            setSelectedAppId("")
        }
    }, [appId, isAppScoped, props.open])

    useEffect(() => {
        if (!props.open) return
        if (!isAppScoped) return
        if (!selectedAppId) return
        if (activePanel !== "appPanel") return
        setActivePanel("variantPanel")
    }, [props.open, isAppScoped, selectedAppId, activePanel])

    const handleAppSelection = useCallback(
        (value: string) => {
            if (value === selectedAppId) return
            setSelectedAppId(value)
            setSelectedTestsetId("")
            setSelectedVariantRevisionIds([])
            setSelectedEvalConfigs([])
            setEvaluationName("")
            setActivePanel("variantPanel")
            setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
        },
        [
            selectedAppId,
            isAppScoped,
            setSelectedTestsetId,
            setSelectedVariantRevisionIds,
            setSelectedEvalConfigs,
            setEvaluationName,
            setActivePanel,
            setAdvanceSettings,
        ],
    )

    const {variants: appVariantRevisions, isLoading: variantsLoading} = useAppVariantRevisions(
        selectedAppId || null,
    )
    const filteredVariants = useMemo(() => {
        if (!selectedAppId) return []
        return appVariantRevisions || []
    }, [appVariantRevisions, selectedAppId])

    const {createNewRun: createPreviewEvaluationRun} = usePreviewEvaluations({
        appId: selectedAppId || appId,
    })
    const {testsets, isLoading: testsetsLoading} = useTestsetsData()

    const {secrets} = useVaultSecret()

    const handlePanelChange = useCallback((key: string | string[]) => {
        setActivePanel(key as string)
    }, [])

    const afterClose = useCallback(() => {
        props?.afterClose?.()
        setEvaluationName("")
        setSelectedEvalConfigs([])
        setSelectedTestsetId("")
        setSelectedVariantRevisionIds([])
        setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
        setActivePanel("appPanel")
        if (!isAppScoped) {
            setSelectedAppId("")
        }
    }, [props?.afterClose, isAppScoped])

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
        const variant = filteredVariants?.find((v) => selectedVariantRevisionIds.includes(v.id))
        const testset = testsets?.find((ts) => ts._id === selectedTestsetId)
        if (!variant || !testset) return ""
        return `${variant.variantName}-v${variant.revision}-${testset.name}`
    }, [selectedVariantRevisionIds, selectedTestsetId, filteredVariants, testsets])

    // Auto-generate / update evaluation name intelligently to avoid loops
    const lastAutoNameRef = useRef<string>("")
    const lastBaseRef = useRef<string>("")
    const randomWordRef = useRef<string>("")

    // Generate a short, readable random suffix (stable per modal open)
    const genRandomWord = () => {
        // Prefer Web Crypto for better entropy
        const n = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0
        if (n) return n.toString(36).slice(0, 5)
        // Fallback to Math.random
        return Math.random().toString(36).slice(2, 7)
    }

    useEffect(() => {
        if (!props.open) return
        // New random suffix per open, and reset last suggestion trackers
        randomWordRef.current = genRandomWord()
        lastAutoNameRef.current = ""
        lastBaseRef.current = ""
        return () => {
            randomWordRef.current = ""
        }
    }, [props.open])
    useEffect(() => {
        if (!generatedNameBase) return
        if (nameFocused) return // user typing

        // When base (variant/testset) changed → generate new suggestion
        if (generatedNameBase !== lastBaseRef.current) {
            // Ensure we have a random word for this session
            if (!randomWordRef.current) randomWordRef.current = genRandomWord()
            const randomWord = randomWordRef.current
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

    const validateSubmission = useCallback(async () => {
        if (!evaluationName) {
            message.error("Please enter evaluation name")
            return false
        }
        if (!selectedTestsetId) {
            message.error("Please select a testset")
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
            const revisions = filteredVariants?.filter((rev) =>
                selectedVariantRevisionIds.includes(rev.id),
            )
            if (!revisions?.length) {
                message.error("Please select variant")
                return false
            }

            const variantInputs = revisions
                .map((rev) => {
                    const store = getDefaultStore()
                    const flags = store.get(variantFlagsAtomFamily({revisionId: rev.id})) as any
                    const spec = store.get(appSchemaAtom) as any
                    const routePath = store.get(appUriInfoAtom)?.routePath || ""
                    const schemaKeys = spec
                        ? extractInputKeysFromSchema(spec as any, routePath)
                        : []
                    if (flags?.isCustom) {
                        // Custom workflows: strictly use schema-defined input keys
                        return schemaKeys
                    }
                    // Non-custom: use stable variables from saved parameters (ignore live edits)
                    const stableVars = store.get(stablePromptVariablesAtomFamily(rev.id)) || []
                    return Array.from(new Set(stableVars))
                })
                .flat()

            const testset = await fetchTestset(selectedTestsetId)
            if (!testset) {
                message.error("Please select a testset")
                return false
            }
            const testsetColumns = Object.keys(testset?.csvdata[0] || {})

            if (!testsetColumns.length) {
                message.error("Please select a correct testset which has testcases")
                return false
            }

            // Validate that testset contains required expected answer columns from selected evaluator configs
            const missingColumnConfigs = selectedEvalConfigs
                .map((configId) => evaluatorConfigs.find((config) => config.id === configId))
                .filter((config) => {
                    // Only check configs that have a correct_answer_key setting
                    if (!config?.settings_values?.correct_answer_key) return false
                    const expectedColumn = config.settings_values.correct_answer_key
                    return !testsetColumns.includes(expectedColumn)
                })

            if (missingColumnConfigs.length > 0) {
                const missingColumns = missingColumnConfigs
                    .map((config) => config?.settings_values?.correct_answer_key)
                    .filter(Boolean)
                    .join(", ")
                message.error(
                    `Please select a testset that has the required expected answer columns: ${missingColumns}`,
                )
                return false
            }

            if (variantInputs.length > 0) {
                const isInputParamsAndTestsetColumnsMatch = variantInputs.every((input) => {
                    return testsetColumns.includes(input)
                })
                if (!isInputParamsAndTestsetColumnsMatch) {
                    message.error(
                        "The testset columns do not match the selected variant input parameters",
                    )
                    return false
                }
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
        advanceSettings,
        filteredVariants,
        testsets,
        evaluationType,
    ])

    const onSubmit = useCallback(async () => {
        setSubmitLoading(true)
        try {
            if (!(await validateSubmission())) return

            const targetAppId = selectedAppId || appId
            if (!targetAppId) {
                message.error("Please select an application")
                setSubmitLoading(false)
                return
            }

            const revisions = filteredVariants
            const {correct_answer_column, ...rateLimitValues} = advanceSettings

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
                    correctAnswerColumn: correct_answer_column,
                }

                if (
                    !selectionData.revisions?.length ||
                    !selectionData.testset ||
                    !selectionData.evaluators?.length ||
                    (evaluationType === "human" && !evaluationName)
                ) {
                    message.error(
                        `Please select a testset, app variant, ${evaluationType === "human" ? "evaluation name, and" : " and"} evaluator configuration. Missing: ${
                            !selectionData.revisions?.length ? "app revision" : ""
                        } ${!selectionData.testset ? "testset" : ""} ${
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
                    const scope = isAppScoped ? "app" : "project"
                    const targetPath = buildEvaluationNavigationUrl({
                        scope,
                        baseAppURL,
                        projectURL,
                        appId: targetAppId,
                        path: `/evaluations/single_model_test/${runId}`,
                    })

                    if (scope === "project") {
                        router.push({
                            pathname: targetPath,
                            query: targetAppId ? {app_id: targetAppId} : undefined,
                        })
                    } else {
                        router.push(targetPath)
                    }
                }
            } else {
                createEvaluation(targetAppId, {
                    testset_id: selectedTestsetId,
                    revisions_ids: selectedVariantRevisionIds,
                    evaluators_configs: selectedEvalConfigs,
                    rate_limit: rateLimitValues,
                    correct_answer_column: correct_answer_column,
                    name: evaluationName,
                })
                    .then(onSuccess)
                    .catch(console.error)
                    .finally(() => {
                        // refetch
                        setSubmitLoading(false)
                    })
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
        selectedAppId,
        selectedTestsetId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        advanceSettings,
        evaluatorConfigs,
        evaluationName,
        filteredVariants,
        testsets,
        evaluators,
        preview,
        validateSubmission,
        createPreviewEvaluationRun,
        baseAppURL,
        onSuccess,
    ])

    return (
        <EnhancedModal
            title={<span>New {evaluationType === "auto" ? "Auto" : "Human"} Evaluation</span>}
            onOk={onSubmit}
            okText="Start Evaluation"
            okButtonProps={{id: "tour-new-eval-start"}}
            maskClosable={false}
            width={1200}
            zIndex={900}
            className={classes.modalContainer}
            confirmLoading={submitLoading}
            afterClose={afterClose}
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
                isLoading={
                    loadingEvaluators ||
                    loadingEvaluatorConfigs ||
                    testsetsLoading ||
                    variantsLoading
                }
                isOpen={props.open}
                testsets={selectedAppId ? testsets || [] : []}
                variants={filteredVariants}
                variantsLoading={variantsLoading}
                evaluators={evaluators}
                evaluatorConfigs={evaluatorConfigs}
                advanceSettings={advanceSettings}
                setAdvanceSettings={setAdvanceSettings}
                appOptions={appOptions}
                selectedAppId={selectedAppId}
                onSelectApp={handleAppSelection}
                appSelectionDisabled={isAppScoped}
            />
        </EnhancedModal>
    )
}

export default memo(NewEvaluationModal)

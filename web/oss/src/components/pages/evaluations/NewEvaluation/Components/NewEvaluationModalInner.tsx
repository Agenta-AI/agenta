import {useCallback, memo, useEffect, useMemo, useRef, useState} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {message} from "@/oss/components/AppMessageContext"
import useURL from "@/oss/hooks/useURL"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {useAppsData} from "@/oss/state/app/hooks"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {useTestsetsData} from "@/oss/state/testset"

import {buildEvaluationNavigationUrl} from "../../utils"
import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import type {LLMRunRateLimitWithCorrectAnswer, NewEvaluationModalInnerProps} from "../types"

const NewEvaluationModalContent = dynamic(() => import("./NewEvaluationModalContent"), {
    ssr: false,
})

/**
 * Inner component that contains all the heavy logic for the NewEvaluationModal.
 * This component only mounts when the modal is open, preventing unnecessary
 * data fetching and state initialization when the modal is closed.
 */
const NewEvaluationModalInner = ({
    onSuccess,
    preview,
    evaluationType,
    onSubmitStateChange,
    isOpen,
}: NewEvaluationModalInnerProps) => {
    // Use appIdentifiersAtom directly to get the URL-derived appId without fallback to stale values
    const {appId} = useAtomValue(appIdentifiersAtom)
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
        appId: selectedAppId || null,
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

    const [selectedTestsetId, setSelectedTestsetId] = useState("")
    const [selectedTestsetRevisionId, setSelectedTestsetRevisionId] = useState("")
    const [selectedTestsetName, setSelectedTestsetName] = useState("")
    const [selectedTestsetVersion, setSelectedTestsetVersion] = useState<number | null>(null)
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
        }
    }, [appId, isAppScoped])

    useEffect(() => {
        if (!isAppScoped) return
        if (!selectedAppId) return
        if (activePanel !== "appPanel") return
        setActivePanel("variantPanel")
    }, [isAppScoped, selectedAppId, activePanel])

    const handleAppSelection = useCallback(
        (value: string) => {
            if (value === selectedAppId) return
            setSelectedAppId(value)
            setSelectedTestsetId("")
            setSelectedTestsetRevisionId("")
            setSelectedTestsetName("")
            setSelectedTestsetVersion(null)
            setSelectedVariantRevisionIds([])
            setSelectedEvalConfigs([])
            setEvaluationName("")
            setActivePanel("variantPanel")
            setAdvanceSettings(DEFAULT_ADVANCE_SETTINGS)
        },
        [selectedAppId],
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
        skip: false,
    })
    const {testsets, isLoading: testsetsLoading} = useTestsetsData()

    const {secrets} = useVaultSecret()

    const handlePanelChange = useCallback((key: string | string[]) => {
        setActivePanel(key as string)
    }, [])

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
        // New random suffix on mount
        randomWordRef.current = genRandomWord()
        lastAutoNameRef.current = ""
        lastBaseRef.current = ""
        return () => {
            randomWordRef.current = ""
        }
    }, [])

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

        // If user cleared the field (blur) → restore auto-name
        if (!evaluationName) {
            setEvaluationName(lastAutoNameRef.current)
        }
    }, [generatedNameBase, evaluationName, nameFocused, evaluationType])

    const validateSubmission = useCallback(async () => {
        if (!evaluationName) {
            message.error("Please enter evaluation name")
            return false
        }
        if (!selectedTestsetId || !selectedTestsetRevisionId) {
            message.error("Please select a testset revision")
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

        // Variant / column validation is temporarily disabled
        return true
    }, [
        evaluationName,
        selectedTestsetId,
        selectedTestsetRevisionId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        evaluatorConfigs,
        preview,
        secrets,
    ])

    const onSubmit = useCallback(async () => {
        onSubmitStateChange?.(true)
        try {
            if (!(await validateSubmission())) {
                onSubmitStateChange?.(false)
                return
            }

            const targetAppId = selectedAppId || appId
            if (!targetAppId) {
                message.error("Please select an application")
                onSubmitStateChange?.(false)
                return
            }

            const revisions = filteredVariants
            const {correct_answer_column, ...rateLimitValues} = advanceSettings

            if (preview) {
                const evalDataSource: any[] = (evaluators as any[]) || []

                const selectionTestset = selectedTestsetId
                    ? ({
                          _id: selectedTestsetId,
                          revisionId: selectedTestsetRevisionId || undefined,
                      } as any)
                    : undefined

                const selectionData = {
                    name: evaluationName,
                    revisions: revisions
                        ?.filter((rev) => selectedVariantRevisionIds.includes(rev.id))
                        .filter(Boolean),
                    testset: selectionTestset,
                    evaluators: selectedEvalConfigs
                        .map((id) => evalDataSource.find((config) => (config as any).id === id))
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
                        `Please select a testset, app variant, ${
                            evaluationType === "human" ? "evaluation name, and" : " and"
                        } evaluator configuration. Missing: ${
                            !selectionData.revisions?.length ? "app revision" : ""
                        } ${!selectionData.testset ? "testset" : ""} ${
                            !selectionData.evaluators?.length
                                ? "evaluators"
                                : evaluationType === "human" && !evaluationName
                                  ? "evaluation name"
                                  : ""
                        }`,
                    )
                    onSubmitStateChange?.(false)
                    return
                }

                const data = await createPreviewEvaluationRun(structuredClone(selectionData))

                const runId = data.run.runs[0].id
                const scope = isAppScoped ? "app" : "project"
                const targetPath = buildEvaluationNavigationUrl({
                    scope,
                    baseAppURL,
                    projectURL,
                    appId: targetAppId,
                    path: `/evaluations/results/${runId}`,
                })

                onSuccess?.()

                router.push({
                    pathname: targetPath,
                    query: {type: "human", view: "focus"},
                })
            } else {
                try {
                    await createEvaluation(targetAppId, {
                        testset_id: selectedTestsetRevisionId || selectedTestsetId,
                        revisions_ids: selectedVariantRevisionIds,
                        evaluators_configs: selectedEvalConfigs,
                        rate_limit: rateLimitValues,
                        correct_answer_column: correct_answer_column,
                        name: evaluationName,
                    })
                    // Trigger revalidation and close modal after successful creation
                    onSuccess?.()
                } catch (error) {
                    console.error("[NewEvaluationModal] Error creating auto evaluation:", error)
                }
            }
        } catch (error) {
            console.error(error)
        } finally {
            onSubmitStateChange?.(false)
        }
    }, [
        appId,
        selectedAppId,
        selectedTestsetId,
        selectedTestsetRevisionId,
        selectedVariantRevisionIds,
        selectedEvalConfigs,
        advanceSettings,
        evaluators,
        evaluationName,
        filteredVariants,
        preview,
        validateSubmission,
        createPreviewEvaluationRun,
        baseAppURL,
        projectURL,
        onSuccess,
        onSubmitStateChange,
        isAppScoped,
        evaluationType,
        router,
    ])

    // Expose submit handler to parent via a temporary window property
    useEffect(() => {
        if (typeof window !== "undefined") {
            ;(window as any).__newEvalModalSubmit = onSubmit
        }
        return () => {
            if (typeof window !== "undefined") {
                delete (window as any).__newEvalModalSubmit
            }
        }
    }, [onSubmit])

    return (
        <NewEvaluationModalContent
            evaluationType={evaluationType}
            onSuccess={onSuccess}
            handlePanelChange={handlePanelChange}
            activePanel={activePanel}
            selectedTestsetId={selectedTestsetId}
            selectedTestsetRevisionId={selectedTestsetRevisionId}
            setSelectedTestsetId={setSelectedTestsetId}
            setSelectedTestsetRevisionId={setSelectedTestsetRevisionId}
            selectedVariantRevisionIds={selectedVariantRevisionIds}
            setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
            selectedEvalConfigs={selectedEvalConfigs}
            setSelectedEvalConfigs={setSelectedEvalConfigs}
            evaluationName={evaluationName}
            setEvaluationName={setEvaluationName}
            preview={preview}
            isLoading={
                loadingEvaluators || loadingEvaluatorConfigs || testsetsLoading || variantsLoading
            }
            isOpen={isOpen}
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
            selectedTestsetName={selectedTestsetName}
            setSelectedTestsetName={setSelectedTestsetName}
            selectedTestsetVersion={selectedTestsetVersion}
            setSelectedTestsetVersion={setSelectedTestsetVersion}
        />
    )
}

export default memo(NewEvaluationModalInner)

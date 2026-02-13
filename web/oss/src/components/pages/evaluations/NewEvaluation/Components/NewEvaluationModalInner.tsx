import {useCallback, memo, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {useAtom, useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {FIRST_EVALUATION_TOUR_ID} from "@/oss/components/Onboarding/tours/firstEvaluationTour"
import useURL from "@/oss/hooks/useURL"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import useAppVariantRevisions from "@/oss/lib/hooks/useAppVariantRevisions"
import useFetchEvaluatorsData from "@/oss/lib/hooks/useFetchEvaluatorsData"
import usePreviewEvaluations from "@/oss/lib/hooks/usePreviewEvaluations"
import {activeTourIdAtom, currentStepStateAtom} from "@/oss/lib/onboarding"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {useAppsData} from "@/oss/state/app/hooks"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {testsetsListQueryAtomFamily} from "@/oss/state/entities/testset"

import {buildEvaluationNavigationUrl} from "../../utils"
import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import {newEvaluationActivePanelAtom} from "../state/panel"
import {
    selectedEvalConfigsAtom,
    selectedTestsetIdAtom,
    selectedTestsetNameAtom,
    selectedTestsetRevisionIdAtom,
    selectedTestsetVersionAtom,
} from "../state/selection"
import type {LLMRunRateLimitWithCorrectAnswer, NewEvaluationModalInnerProps} from "../types"

const NewEvaluationModalContent = dynamic(() => import("./NewEvaluationModalContent"), {
    ssr: false,
})

/**
 * Inner component that contains all the heavy logic for the NewEvaluationModal.
 * This component only mounts when the modal is open, preventing unnecessary
 * data fetching and state initialization when the modal is closed.
 */
/** Determines which panel to show initially based on preselection and app scope */
const getInitialPanel = (hasPreSelected: boolean, isAppScoped: boolean): string =>
    hasPreSelected ? "testsetPanel" : isAppScoped ? "variantPanel" : "appPanel"

const NewEvaluationModalInner = ({
    onSuccess,
    preview,
    evaluationType,
    onSubmitStateChange,
    preSelectedVariantIds,
    preSelectedAppId,
}: NewEvaluationModalInnerProps) => {
    // Use appIdentifiersAtom directly to get the URL-derived appId without fallback to stale values
    const {appId} = useAtomValue(appIdentifiersAtom)
    // Consider pre-selected app ID from playground, fallback to URL-derived appId
    const effectiveAppId = preSelectedAppId || appId || ""
    const isAppScoped = Boolean(effectiveAppId)
    const {apps: availableApps = []} = useAppsData()
    const [selectedAppId, setSelectedAppId] = useState<string>(effectiveAppId)
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

    const [selectedTestsetId, setSelectedTestsetId] = useAtom(selectedTestsetIdAtom)
    const [selectedTestsetRevisionId, setSelectedTestsetRevisionId] = useAtom(
        selectedTestsetRevisionIdAtom,
    )
    const [selectedTestsetName, setSelectedTestsetName] = useAtom(selectedTestsetNameAtom)
    const [selectedTestsetVersion, setSelectedTestsetVersion] = useAtom(selectedTestsetVersionAtom)
    const [selectedEvalConfigs, setSelectedEvalConfigs] = useAtom(selectedEvalConfigsAtom)

    // Reset testset selection on mount to match previous local state behavior
    useEffect(() => {
        setSelectedTestsetId("")
        setSelectedTestsetRevisionId("")
        setSelectedTestsetName("")
        setSelectedTestsetVersion(null)
        setSelectedEvalConfigs([])
    }, [
        setSelectedEvalConfigs,
        setSelectedTestsetId,
        setSelectedTestsetName,
        setSelectedTestsetRevisionId,
        setSelectedTestsetVersion,
    ])
    // Initialize with pre-selected variants (e.g., from playground comparison mode)
    const [selectedVariantRevisionIds, setSelectedVariantRevisionIds] = useState<string[]>(() =>
        preSelectedVariantIds?.length ? [...preSelectedVariantIds] : [],
    )
    const activeTourId = useAtomValue(activeTourIdAtom)
    const currentStepState = useAtomValue(currentStepStateAtom)
    // If variants are pre-selected, start on testset panel; otherwise follow normal flow
    const hasPreSelectedVariants = Boolean(preSelectedVariantIds?.length)
    const [activePanel, setActivePanel] = useAtom(newEvaluationActivePanelAtom)
    const [evaluationName, setEvaluationName] = useState("")
    const [nameFocused, setNameFocused] = useState(false)
    const [advanceSettings, setAdvanceSettings] =
        useState<LLMRunRateLimitWithCorrectAnswer>(DEFAULT_ADVANCE_SETTINGS)

    const allowTestsetAutoAdvance = !(
        activeTourId === FIRST_EVALUATION_TOUR_ID &&
        currentStepState.step?.panelKey === "testsetPanel"
    )

    useLayoutEffect(() => {
        if (activeTourId !== FIRST_EVALUATION_TOUR_ID) return
        const panelKey = currentStepState.step?.panelKey
        if (!panelKey || panelKey === activePanel) return
        setActivePanel(panelKey)
    }, [activePanel, activeTourId, currentStepState.step?.panelKey, setActivePanel])

    useEffect(() => {
        if (isAppScoped) {
            setSelectedAppId(effectiveAppId)
        }
    }, [effectiveAppId, isAppScoped])

    useEffect(() => {
        const initialPanel = getInitialPanel(hasPreSelectedVariants, isAppScoped)
        setActivePanel(initialPanel)
        return () => {
            setActivePanel(null)
        }
    }, [hasPreSelectedVariants, isAppScoped, setActivePanel])

    useEffect(() => {
        if (!isAppScoped) return
        if (!selectedAppId) return
        if (activePanel !== "appPanel") return
        setActivePanel("variantPanel")
    }, [isAppScoped, selectedAppId, activePanel, setActivePanel])

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
    const testsetsQuery = useAtomValue(testsetsListQueryAtomFamily(null))
    const testsets = testsetsQuery.data?.testsets ?? []
    const testsetsLoading = testsetsQuery.isPending

    const {secrets} = useVaultSecret()

    const handlePanelChange = useCallback((key: string | string[]) => {
        setActivePanel(key as string)
    }, [])

    // Handler for when a new evaluator config is created via the inline drawer
    const handleEvaluatorCreated = useCallback(
        async (configId?: string) => {
            // Refetch evaluator configs to get the newly created one
            await evaluationData.refetchEvaluatorConfigs()

            // Auto-select the newly created evaluator config
            if (configId) {
                setSelectedEvalConfigs((prev) => [...prev, configId])
            }
        },
        [evaluationData],
    )

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
        if (!selectedVariantRevisionIds.length || !selectedTestsetName) return ""
        if (selectedVariantRevisionIds.length > 1) {
            return `${selectedVariantRevisionIds.length}-variants-${selectedTestsetName}`
        }
        const variant = filteredVariants?.find((v) => selectedVariantRevisionIds.includes(v.id))
        if (!variant) return ""
        return `${variant.variantName}-v${variant.revision}-${selectedTestsetName}`
    }, [selectedVariantRevisionIds, selectedTestsetName, filteredVariants])

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
                    resolveEvaluatorKey(evaluatorConfigs.find((config) => config.id === id)) ===
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
                    const response = await createEvaluation(targetAppId, {
                        testset_id: selectedTestsetId,
                        testset_revision_id: selectedTestsetRevisionId,
                        revisions_ids: selectedVariantRevisionIds,
                        evaluator_ids: selectedEvalConfigs,
                        rate_limit: rateLimitValues,
                        correct_answer_column: correct_answer_column,
                        name: evaluationName,
                    })

                    // Extract run ID from response and build link to results
                    const runId = response.data?.runs?.[0]?.id
                    if (runId) {
                        const scope = isAppScoped ? "app" : "project"
                        const resultsUrl = buildEvaluationNavigationUrl({
                            scope,
                            baseAppURL,
                            projectURL,
                            appId: targetAppId,
                            path: `/evaluations/results/${runId}`,
                        })

                        message.success(
                            <span>
                                Evaluation started.{" "}
                                <a
                                    href={resultsUrl}
                                    onClick={(e) => {
                                        e.preventDefault()
                                        router.push(resultsUrl)
                                    }}
                                    className="underline font-medium"
                                >
                                    View progress
                                </a>
                            </span>,
                        )
                    } else {
                        message.success("Evaluation started")
                    }

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
            selectedTestsetName={selectedTestsetName}
            selectedTestsetVersion={selectedTestsetVersion}
            setSelectedTestsetId={setSelectedTestsetId}
            setSelectedTestsetRevisionId={setSelectedTestsetRevisionId}
            setSelectedTestsetName={setSelectedTestsetName}
            setSelectedTestsetVersion={setSelectedTestsetVersion}
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
            isOpen={true} // Always true since this component only renders when modal is open
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
            onEvaluatorCreated={handleEvaluatorCreated}
            allowTestsetAutoAdvance={allowTestsetAutoAdvance}
        />
    )
}

export default memo(NewEvaluationModalInner)

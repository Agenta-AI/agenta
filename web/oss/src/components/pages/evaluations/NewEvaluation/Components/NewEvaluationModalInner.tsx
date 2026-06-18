import {memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState} from "react"
import type {SetStateAction} from "react"

import {useVaultSecret} from "@agenta/entities/secret"
import {extractSourceIdFromDraft, isLocalDraftId, isValidUUID} from "@agenta/entities/shared"
import {
    evaluatorsListDataAtom,
    invalidateEvaluatorsListCache,
    invalidateWorkflowsListCache,
    workflowMolecule,
    workflowRevisionsByWorkflowListDataAtomFamily,
} from "@agenta/entities/workflow"
import {
    assertValidStepConfig,
    composeEvaluationStepPayload,
    findFirstIncompleteRequiredStep,
    findInitialEvaluationStep,
    findNextEvaluationStep,
    type EvaluationStepSlot,
} from "@agenta/evaluations/core"
import {usePreviewEvaluations} from "@agenta/evaluations/hooks"
import {message} from "@agenta/ui/app-message"
import {useAtom, useAtomValue, useSetAtom} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {
    clearEvaluatorWorkflowCache,
    evaluatorsPaginatedStore,
} from "@/oss/components/Evaluators/store/evaluatorsPaginatedStore"
import {FIRST_EVALUATION_TOUR_ID} from "@/oss/components/Onboarding/tours/firstEvaluationTour"
import {registryWorkflowIdOverrideAtom} from "@/oss/components/VariantsComponents/store/registryStore"
import useURL from "@/oss/hooks/useURL"
import {resolveEvaluatorKey} from "@/oss/lib/evaluators/utils"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import {activeTourIdAtom, currentStepStateAtom} from "@/oss/lib/onboarding"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {useAppsData} from "@/oss/state/app/hooks"
import {currentAppContextAtom} from "@/oss/state/app/selectors/app"
import {appIdentifiersAtom} from "@/oss/state/appState"
import {getProjectValues} from "@/oss/state/project"

import {buildEvaluationNavigationUrl} from "../../utils"
import {
    EVAL_STEP_KINDS,
    evalStepEngineRegistry,
    evalStepRegistry,
    getDefaultEvalSteps,
} from "../evalSteps/registry"
import {activeEvalStepAtom, evalStepsConfigAtom, evalStepValuesAtom} from "../evalSteps/state"
import type {
    ApplicationStepValue,
    EvalStepContext,
    EvalStepKind,
    EvalStepRuntime,
    EvalStepSlot,
    EvalStepValueMap,
} from "../evalSteps/types"
import type {NewEvaluationModalInnerProps} from "../types"

const NewEvaluationModalContent = dynamic(() => import("./NewEvaluationModalContent"), {
    ssr: false,
})

const TOUR_PANEL_TO_STEP: Record<string, EvalStepKind> = {
    appPanel: "application",
    variantPanel: "revision",
    testsetPanel: "testset",
    evaluatorPanel: "evaluator",
    advancedSettingsPanel: "advanced",
}

const cloneDefaultValue = <Kind extends EvalStepKind>(kind: Kind): EvalStepValueMap[Kind] =>
    structuredClone(evalStepRegistry[kind].defaultValue)

const resolveSlotValue = <Kind extends EvalStepKind>(
    slot: EvalStepSlot & {kind: Kind},
): EvalStepValueMap[Kind] =>
    slot.preset === undefined
        ? cloneDefaultValue(slot.kind)
        : (structuredClone(slot.preset) as EvalStepValueMap[Kind])

const NewEvaluationModalInner = ({
    onSuccess,
    preview = false,
    evaluationType,
    onSubmitStateChange,
    preSelectedVariantIds,
    preSelectedAppId,
    steps,
    nameBuilder,
}: NewEvaluationModalInnerProps) => {
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()
    const projectId = getProjectValues().projectId ?? undefined
    const {appId: routeAppId} = useAtomValue(appIdentifiersAtom)
    const evaluatorWorkflows = useAtomValue(evaluatorsListDataAtom)
    const {apps: availableApps = []} = useAppsData()
    const [stepValues, setStepValues] = useAtom(evalStepValuesAtom)
    const stepValuesRef = useRef(stepValues)
    const setActiveStep = useSetAtom(activeEvalStepAtom)
    const setStepsConfig = useSetAtom(evalStepsConfigAtom)
    const setRegistryWorkflowIdOverride = useSetAtom(registryWorkflowIdOverrideAtom)

    const sanitizedPreSelectedAppId = useMemo(() => {
        if (!preSelectedAppId) return undefined
        if (!evaluatorWorkflows.some((workflow) => workflow.id === preSelectedAppId)) {
            return preSelectedAppId
        }
        if (process.env.NODE_ENV !== "production") {
            console.warn(
                `[NewEvaluationModal] preSelectedAppId resolves to an evaluator workflow (${preSelectedAppId}) — ignoring.`,
            )
        }
        return undefined
    }, [evaluatorWorkflows, preSelectedAppId])

    const effectiveAppId = sanitizedPreSelectedAppId || routeAppId || ""
    const isAppScoped = Boolean(effectiveAppId)

    const resolvedStepsRef = useRef<EvalStepSlot[] | null>(null)
    if (!resolvedStepsRef.current) {
        const configured = (steps ?? getDefaultEvalSteps()).map((slot) => ({...slot}))
        const initialSteps = configured.map((slot) => {
            if (slot.kind === "application" && effectiveAppId && slot.preset === undefined) {
                return {
                    ...slot,
                    preset: {id: effectiveAppId},
                    locked: true,
                } satisfies EvalStepSlot
            }
            if (
                slot.kind === "revision" &&
                preSelectedVariantIds?.length &&
                slot.preset === undefined
            ) {
                return {...slot, preset: [...preSelectedVariantIds]} satisfies EvalStepSlot
            }
            return slot
        })
        assertValidStepConfig(initialSteps, EVAL_STEP_KINDS)
        resolvedStepsRef.current = initialSteps
    }
    const resolvedSteps = resolvedStepsRef.current

    const updateStepValues = useCallback(
        (update: SetStateAction<Partial<EvalStepValueMap>>) => {
            const next = typeof update === "function" ? update(stepValuesRef.current) : update
            stepValuesRef.current = next
            setStepValues(next)
        },
        [setStepValues],
    )

    useLayoutEffect(() => {
        const initialValues = Object.fromEntries(
            EVAL_STEP_KINDS.values().map((kind) => [kind, cloneDefaultValue(kind)]),
        ) as unknown as EvalStepValueMap
        for (const slot of resolvedSteps) {
            initialValues[slot.kind] = resolveSlotValue(slot) as never
        }
        stepValuesRef.current = initialValues
        setStepValues(initialValues)
        setStepsConfig(resolvedSteps)
        return () => {
            stepValuesRef.current = {}
            setStepValues({})
            setStepsConfig([])
            setActiveStep(null)
        }
    }, [resolvedSteps, setActiveStep, setStepValues, setStepsConfig])

    const application = (stepValues.application ??
        evalStepRegistry.application.defaultValue) as ApplicationStepValue
    const selectedAppId = application.id
    const revisionIds = (stepValues.revision ?? evalStepRegistry.revision.defaultValue) as string[]
    const testset = (stepValues.testset ??
        evalStepRegistry.testset.defaultValue) as EvalStepValueMap["testset"]
    const evaluatorIds = (stepValues.evaluator ??
        evalStepRegistry.evaluator.defaultValue) as string[]
    const advanceSettings = (stepValues.advanced ??
        evalStepRegistry.advanced.defaultValue) as EvalStepValueMap["advanced"]

    useEffect(() => {
        setRegistryWorkflowIdOverride(selectedAppId || null)
        return () => setRegistryWorkflowIdOverride(null)
    }, [selectedAppId, setRegistryWorkflowIdOverride])

    const appOptions = useMemo(() => {
        const options = availableApps.map((app) => ({
            label: app.name ?? app.slug ?? "",
            value: app.id,
            type: app.flags?.is_custom
                ? "custom"
                : app.flags?.is_chat
                  ? "chat"
                  : ("completion" as string | null),
            createdAt: app.created_at ?? null,
            updatedAt: app.updated_at ?? null,
        }))
        if (selectedAppId && !options.some((option) => option.value === selectedAppId)) {
            const evaluator = evaluatorWorkflows.find((workflow) => workflow.id === selectedAppId)
            options.push({
                label: application.label ?? evaluator?.name ?? evaluator?.slug ?? selectedAppId,
                value: selectedAppId,
                type: (application.isEvaluator ?? Boolean(evaluator)) ? "evaluator" : null,
                createdAt: null,
                updatedAt: null,
            })
        }
        return options
    }, [
        application.isEvaluator,
        application.label,
        availableApps,
        evaluatorWorkflows,
        selectedAppId,
    ])

    useEffect(() => {
        if (!selectedAppId || application.label) return
        const option = appOptions.find((candidate) => candidate.value === selectedAppId)
        if (!option?.label) return
        updateStepValues((current) => ({
            ...current,
            application: {...application, label: option.label},
        }))
    }, [appOptions, application, selectedAppId, updateStepValues])

    const workflowRevisions = useAtomValue(
        useMemo(
            () => workflowRevisionsByWorkflowListDataAtomFamily(selectedAppId || ""),
            [selectedAppId],
        ),
    )
    const filteredVariants = useMemo(
        () => (selectedAppId ? workflowRevisions || [] : []),
        [selectedAppId, workflowRevisions],
    )

    const getStepValue = useCallback(
        <Kind extends EvalStepKind>(kind: Kind): EvalStepValueMap[Kind] =>
            (stepValuesRef.current[kind] ??
                evalStepRegistry[kind].defaultValue) as EvalStepValueMap[Kind],
        [],
    )

    const isVisible = useCallback(
        (slot: EvaluationStepSlot<EvalStepKind>) =>
            !slot.hidden &&
            (evalStepRegistry[slot.kind].isVisible?.({
                projectId,
                appId: getStepValue("application").id || undefined,
                evaluationType,
                preview,
                getStepValue,
                setStepValue: () => undefined,
                advanceFrom: () => undefined,
            }) ??
                true),
        [evaluationType, getStepValue, preview, projectId],
    )

    const baseContext = useMemo(
        () => ({
            projectId,
            appId: selectedAppId || undefined,
            evaluationType,
            preview,
        }),
        [evaluationType, preview, projectId, selectedAppId],
    )

    const advanceFrom = useCallback(
        (kind: EvalStepKind) => {
            const context = {
                ...baseContext,
                getStepValue,
                setStepValue: () => undefined,
                advanceFrom: () => undefined,
            } as EvalStepContext
            const next = findNextEvaluationStep(
                kind,
                resolvedSteps,
                evalStepEngineRegistry,
                getStepValue,
                context,
                isVisible,
            )
            if (next) setActiveStep(next)
        },
        [baseContext, getStepValue, isVisible, resolvedSteps, setActiveStep],
    )

    const handleApplicationSelection = useCallback(
        (nextApplication: ApplicationStepValue) => {
            const nextValues = {...stepValuesRef.current, application: nextApplication}
            const dependsOnApplication = (slot: EvalStepSlot): boolean => {
                const dependencies = slot.dependsOn ?? []
                return dependencies.some((dependency) => {
                    if (dependency === "application") return true
                    const dependencySlot = resolvedSteps.find(
                        (candidate) => candidate.kind === dependency,
                    )
                    return dependencySlot ? dependsOnApplication(dependencySlot) : false
                })
            }
            for (const slot of resolvedSteps) {
                if (slot.kind === "application" || !dependsOnApplication(slot)) continue
                nextValues[slot.kind] = resolveSlotValue(slot) as never
            }
            updateStepValues(nextValues)
            const nextContext = {
                ...baseContext,
                appId: nextApplication.id || undefined,
                getStepValue: <Kind extends EvalStepKind>(kind: Kind) =>
                    (nextValues[kind] ??
                        evalStepRegistry[kind].defaultValue) as EvalStepValueMap[Kind],
                setStepValue: () => undefined,
                advanceFrom: () => undefined,
            } as EvalStepContext
            const next = nextApplication.id
                ? findNextEvaluationStep(
                      "application",
                      resolvedSteps,
                      evalStepEngineRegistry,
                      nextContext.getStepValue,
                      nextContext,
                      isVisible,
                  )
                : "application"
            setActiveStep(next)
            setEvaluationName("")
        },
        [baseContext, isVisible, resolvedSteps, setActiveStep, updateStepValues],
    )

    const setStepValue = useCallback(
        <Kind extends EvalStepKind>(kind: Kind, action: SetStateAction<EvalStepValueMap[Kind]>) => {
            const current = getStepValue(kind)
            const value =
                typeof action === "function"
                    ? (action as (current: EvalStepValueMap[Kind]) => EvalStepValueMap[Kind])(
                          current,
                      )
                    : action
            if (kind === "application") {
                handleApplicationSelection(value as ApplicationStepValue)
                return
            }
            updateStepValues((existing) => ({...existing, [kind]: value}))
        },
        [getStepValue, handleApplicationSelection, updateStepValues],
    )

    const context = useMemo<EvalStepContext>(
        () => ({
            ...baseContext,
            getStepValue,
            setStepValue,
            advanceFrom,
        }),
        [advanceFrom, baseContext, getStepValue, setStepValue],
    )

    useEffect(() => {
        const initial = findInitialEvaluationStep(
            resolvedSteps,
            evalStepEngineRegistry,
            getStepValue,
            context,
            isVisible,
        )
        setActiveStep(initial)
    }, [context, getStepValue, isVisible, resolvedSteps, setActiveStep])

    const activeTourId = useAtomValue(activeTourIdAtom)
    const currentStepState = useAtomValue(currentStepStateAtom)
    const allowTestsetAutoAdvance = !(
        activeTourId === FIRST_EVALUATION_TOUR_ID &&
        currentStepState.step?.panelKey === "testsetPanel"
    )

    useLayoutEffect(() => {
        if (activeTourId !== FIRST_EVALUATION_TOUR_ID) return
        const step = TOUR_PANEL_TO_STEP[currentStepState.step?.panelKey ?? ""]
        if (step) setActiveStep(step)
    }, [activeTourId, currentStepState.step?.panelKey, setActiveStep])

    const evaluatorStoreState = useAtomValue(
        evaluatorsPaginatedStore.selectors.state({
            scopeId: "evaluation-evaluator-selector",
            pageSize: 50,
        }),
    )
    const evaluatorRowsByRevisionId = useMemo(() => {
        const rows = new Map<
            string,
            {id: string; workflow_id: string; slug: string; name: string}
        >()
        for (const row of evaluatorStoreState.rows) {
            if (!row.__isSkeleton && row.revisionId) {
                rows.set(row.revisionId, {
                    id: row.revisionId,
                    workflow_id: row.workflowId,
                    slug: typeof row.slug === "string" ? row.slug : "",
                    name: typeof row.name === "string" ? row.name : "",
                })
            }
        }
        return rows
    }, [evaluatorStoreState.rows])

    const isCustomApp = useAtomValue(currentAppContextAtom)?.appType === "custom"
    const {createNewRun: createPreviewEvaluationRun} = usePreviewEvaluations({
        appId: selectedAppId || routeAppId || undefined,
        skip: false,
        isCustomApp,
    })
    const {secrets} = useVaultSecret()

    const handleEvaluatorCreated = useCallback(
        async (configId?: string) => {
            invalidateWorkflowsListCache()
            invalidateEvaluatorsListCache()
            clearEvaluatorWorkflowCache()
            if (configId) {
                setStepValue("evaluator", (current) => [...current, configId])
            }
        },
        [setStepValue],
    )

    const selectedSingleRevisionId = revisionIds.length === 1 ? revisionIds[0] : ""
    const selectedVariantLabel = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.variantLabel(selectedSingleRevisionId),
            [selectedSingleRevisionId],
        ),
    )
    const generatedNameBase = useMemo(() => {
        if (nameBuilder) return nameBuilder(stepValues)
        if (!revisionIds.length || !testset.name) return ""
        if (revisionIds.length > 1) return `${revisionIds.length}-variants-${testset.name}`
        const revision = filteredVariants.find((candidate) => candidate.id === revisionIds[0])
        if (!revision) return ""
        return `${selectedVariantLabel ?? revision.name ?? "-"}-v${revision.version ?? 0}-${testset.name}`
    }, [filteredVariants, nameBuilder, revisionIds, selectedVariantLabel, stepValues, testset.name])

    const [evaluationName, setEvaluationName] = useState("")
    const [nameFocused, setNameFocused] = useState(false)
    const lastAutoNameRef = useRef("")
    const lastBaseRef = useRef("")
    const randomWordRef = useRef("")

    useEffect(() => {
        const value = globalThis.crypto?.getRandomValues?.(new Uint32Array(1))?.[0] ?? 0
        randomWordRef.current = value
            ? value.toString(36).slice(0, 5)
            : Math.random().toString(36).slice(2, 7)
        return () => {
            randomWordRef.current = ""
        }
    }, [])

    useEffect(() => {
        const handleFocus = (event: FocusEvent) =>
            setNameFocused((event.target as HTMLElement).tagName === "INPUT")
        const handleBlur = (event: FocusEvent) => {
            if ((event.target as HTMLElement).tagName === "INPUT") setNameFocused(false)
        }
        document.addEventListener("focusin", handleFocus)
        document.addEventListener("focusout", handleBlur)
        return () => {
            document.removeEventListener("focusin", handleFocus)
            document.removeEventListener("focusout", handleBlur)
        }
    }, [])

    useEffect(() => {
        if (!generatedNameBase || nameFocused) return
        if (generatedNameBase !== lastBaseRef.current) {
            const nextName = `${generatedNameBase}-${randomWordRef.current}`
            const shouldUpdate = !evaluationName || evaluationName === lastAutoNameRef.current
            lastBaseRef.current = generatedNameBase
            lastAutoNameRef.current = nextName
            if (shouldUpdate) setEvaluationName(nextName)
        } else if (!evaluationName) {
            setEvaluationName(lastAutoNameRef.current)
        }
    }, [evaluationName, generatedNameBase, nameFocused])

    const validateSubmission = useCallback(async () => {
        if (!evaluationName) {
            message.error("Please enter evaluation name")
            return false
        }
        const incomplete = findFirstIncompleteRequiredStep(
            resolvedSteps,
            evalStepEngineRegistry,
            getStepValue,
            context,
        )
        if (incomplete) {
            message.error(evalStepRegistry[incomplete].incompleteMessage)
            return false
        }

        const selectedRevisions = filteredVariants.filter((revision) =>
            revisionIds.includes(revision.id),
        )
        if (
            selectedRevisions.some((revision) => {
                if (!isLocalDraftId(revision.id)) return false
                const sourceRevisionId =
                    (revision as {sourceRevisionId?: string | null}).sourceRevisionId ??
                    extractSourceIdFromDraft(revision.id)
                return !(sourceRevisionId && isValidUUID(sourceRevisionId))
            })
        ) {
            message.error(
                "Please commit selected local draft revisions before starting an evaluation.",
            )
            return false
        }

        if (
            !preview &&
            evaluatorIds.some(
                (id) =>
                    resolveEvaluatorKey(workflowMolecule.get.data(id) as never) ===
                    "auto_ai_critique",
            ) &&
            (await redirectIfNoLLMKeys({secrets}))
        ) {
            message.error("LLM keys are required for AI Critique configuration")
            return false
        }
        return true
    }, [
        context,
        evaluationName,
        evaluatorIds,
        filteredVariants,
        getStepValue,
        preview,
        resolvedSteps,
        revisionIds,
        secrets,
    ])

    const onSubmit = useCallback(async () => {
        onSubmitStateChange?.(true)
        try {
            if (!(await validateSubmission())) return

            if (preview) {
                const selectedRevisions = filteredVariants
                    .filter((revision) => revisionIds.includes(revision.id))
                    .map((revision) => {
                        if (isValidUUID(revision.id)) return revision
                        const sourceRevisionId =
                            (revision as {sourceRevisionId?: string | null}).sourceRevisionId ??
                            (isLocalDraftId(revision.id)
                                ? extractSourceIdFromDraft(revision.id)
                                : null)
                        return sourceRevisionId && isValidUUID(sourceRevisionId)
                            ? {...revision, id: sourceRevisionId}
                            : revision
                    })
                const selectionData = {
                    name: evaluationName,
                    revisions: selectedRevisions,
                    testset: testset.id
                        ? {_id: testset.id, revisionId: testset.revisionId || undefined}
                        : undefined,
                    evaluators: evaluatorIds
                        .map((id) => evaluatorRowsByRevisionId.get(id))
                        .filter(Boolean),
                    concurrency: advanceSettings,
                }
                if (
                    !selectedAppId ||
                    !selectionData.revisions.length ||
                    !selectionData.testset ||
                    !selectionData.evaluators.length
                ) {
                    message.error(
                        "Human evaluations require an application, revision, testset, and evaluator.",
                    )
                    return
                }
                const data = await createPreviewEvaluationRun(
                    structuredClone(selectionData) as never,
                )
                const targetPath = buildEvaluationNavigationUrl({
                    scope: isAppScoped ? "app" : "project",
                    baseAppURL,
                    projectURL,
                    appId: selectedAppId,
                    path: `/evaluations/results/${data.runId}`,
                })
                onSuccess?.()
                router.push({
                    pathname: targetPath,
                    query: {type: "human", view: "focus"},
                })
                return
            }

            const payload = await composeEvaluationStepPayload(
                resolvedSteps,
                evalStepEngineRegistry,
                getStepValue,
                context,
            )
            const response = await createEvaluation({
                name: evaluationName,
                data: payload,
            })
            const runCount = response.runs.length
            const runId = response.data.evaluation?.id
            if (runId) {
                const resultsUrl = buildEvaluationNavigationUrl({
                    scope:
                        resolvedSteps.some((slot) => slot.kind === "application") && isAppScoped
                            ? "app"
                            : "project",
                    baseAppURL,
                    projectURL,
                    appId: selectedAppId || undefined,
                    path: `/evaluations/results/${runId}`,
                })
                message.success(
                    <span>
                        {runCount > 1 ? `${runCount} evaluations started.` : "Evaluation started."}{" "}
                        <a
                            href={resultsUrl}
                            onClick={(event) => {
                                event.preventDefault()
                                router.push(resultsUrl)
                            }}
                            className="underline font-medium"
                        >
                            View progress
                        </a>
                    </span>,
                )
            } else {
                message.success(
                    runCount > 1 ? `${runCount} evaluations started` : "Evaluation started",
                )
            }
            onSuccess?.()
        } catch (error) {
            console.error("[NewEvaluationModal] Error creating evaluation:", error)
            message.error("Unable to start evaluation")
        } finally {
            onSubmitStateChange?.(false)
        }
    }, [
        advanceSettings,
        baseAppURL,
        context,
        createPreviewEvaluationRun,
        evaluationName,
        evaluatorIds,
        evaluatorRowsByRevisionId,
        filteredVariants,
        getStepValue,
        isAppScoped,
        onSubmitStateChange,
        onSuccess,
        preview,
        projectURL,
        resolvedSteps,
        revisionIds,
        router,
        selectedAppId,
        testset,
        validateSubmission,
    ])

    useEffect(() => {
        if (typeof window === "undefined") return
        ;(
            window as typeof window & {__newEvalModalSubmit?: () => Promise<void>}
        ).__newEvalModalSubmit = onSubmit
        return () => {
            delete (window as typeof window & {__newEvalModalSubmit?: () => Promise<void>})
                .__newEvalModalSubmit
        }
    }, [onSubmit])

    const runtime = useMemo<EvalStepRuntime>(
        () => ({
            appOptions,
            allowTestsetAutoAdvance,
            onSelectApplication: handleApplicationSelection,
            onEvaluatorCreated: handleEvaluatorCreated,
        }),
        [allowTestsetAutoAdvance, appOptions, handleApplicationSelection, handleEvaluatorCreated],
    )

    return (
        <NewEvaluationModalContent
            evaluationName={evaluationName}
            setEvaluationName={setEvaluationName}
            steps={resolvedSteps}
            context={context}
            runtime={runtime}
        />
    )
}

export default memo(NewEvaluationModalInner)

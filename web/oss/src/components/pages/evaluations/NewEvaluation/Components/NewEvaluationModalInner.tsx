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
import {activeEvalStepAtom, evalStepValuesAtom, evaluationNameAtom} from "../evalSteps/state"
import type {
    EvalStepContext,
    EvalStepKind,
    EvalStepRuntime,
    EvalStepSlot,
    EvalStepValueMap,
    InvocationStepValue,
} from "../evalSteps/types"
import type {NewEvaluationModalInnerProps} from "../types"

const NewEvaluationModalContent = dynamic(() => import("./NewEvaluationModalContent"), {
    ssr: false,
})

const TOUR_PANEL_TO_STEP: Record<string, EvalStepKind> = {
    appPanel: "invocation",
    variantPanel: "revision",
    testsetPanel: "testset",
    evaluatorPanel: "evaluator",
    advancedSettingsPanel: "advanced",
}

const MUTUALLY_EXCLUSIVE_STEP_GROUPS: EvalStepKind[][] = [["traces", "query"]]

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
    liveCompatibleEvaluatorsOnly = false,
}: NewEvaluationModalInnerProps) => {
    const router = useRouter()
    const {baseAppURL, projectURL} = useURL()
    const projectId = getProjectValues().projectId ?? undefined
    const {appId: routeAppId} = useAtomValue(appIdentifiersAtom)
    const evaluatorWorkflows = useAtomValue(evaluatorsListDataAtom)
    const {apps: availableApps = []} = useAppsData()
    const [stepValues, setStepValues] = useAtom(evalStepValuesAtom)
    const stepValuesRef = useRef(stepValues)
    const [evaluationName, setEvaluationName] = useAtom(evaluationNameAtom)
    const evaluationNameRef = useRef(evaluationName)
    evaluationNameRef.current = evaluationName
    const [nameFocused, setNameFocused] = useState(false)
    const lastAutoNameRef = useRef("")
    const lastBaseRef = useRef("")
    const randomWordRef = useRef("")
    const setActiveStep = useSetAtom(activeEvalStepAtom)
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
            if (slot.kind === "invocation" && effectiveAppId && slot.preset === undefined) {
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
        assertValidStepConfig(initialSteps, EVAL_STEP_KINDS, MUTUALLY_EXCLUSIVE_STEP_GROUPS)
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
        return () => {
            stepValuesRef.current = {}
            setStepValues({})
            setActiveStep(null)
        }
    }, [resolvedSteps, setActiveStep, setStepValues])

    const invocation = (stepValues.invocation ??
        evalStepRegistry.invocation.defaultValue) as InvocationStepValue
    const selectedWorkflowId = invocation.id
    const revisionIds = (stepValues.revision ?? evalStepRegistry.revision.defaultValue) as string[]
    const testset = (stepValues.testset ??
        evalStepRegistry.testset.defaultValue) as EvalStepValueMap["testset"]
    const evaluatorIds = (stepValues.evaluator ??
        evalStepRegistry.evaluator.defaultValue) as string[]
    const advanceSettings = (stepValues.advanced ??
        evalStepRegistry.advanced.defaultValue) as EvalStepValueMap["advanced"]

    useEffect(() => {
        setRegistryWorkflowIdOverride(selectedWorkflowId || null)
        return () => setRegistryWorkflowIdOverride(null)
    }, [selectedWorkflowId, setRegistryWorkflowIdOverride])

    const selectedWorkflowLabel = useMemo(() => {
        if (!selectedWorkflowId) return undefined
        const app = availableApps.find((candidate) => candidate.id === selectedWorkflowId)
        if (app) return app.name ?? app.slug ?? undefined
        const evaluator = evaluatorWorkflows.find(
            (candidate) => candidate.id === selectedWorkflowId,
        )
        return evaluator?.name ?? evaluator?.slug ?? undefined
    }, [availableApps, evaluatorWorkflows, selectedWorkflowId])

    useEffect(() => {
        if (!selectedWorkflowId || invocation.label || !selectedWorkflowLabel) return
        updateStepValues((current) => ({
            ...current,
            invocation: {...invocation, label: selectedWorkflowLabel},
        }))
    }, [invocation, selectedWorkflowId, selectedWorkflowLabel, updateStepValues])

    const workflowRevisions = useAtomValue(
        useMemo(
            () => workflowRevisionsByWorkflowListDataAtomFamily(selectedWorkflowId || ""),
            [selectedWorkflowId],
        ),
    )
    const filteredVariants = useMemo(
        () => (selectedWorkflowId ? workflowRevisions || [] : []),
        [selectedWorkflowId, workflowRevisions],
    )

    const getStepValue = useCallback(
        <Kind extends EvalStepKind>(kind: Kind): EvalStepValueMap[Kind] =>
            (stepValuesRef.current[kind] ??
                evalStepRegistry[kind].defaultValue) as EvalStepValueMap[Kind],
        [],
    )

    const getEvaluationName = useCallback(() => evaluationNameRef.current, [])

    const isVisible = useCallback(
        (slot: EvaluationStepSlot<EvalStepKind>) =>
            !slot.hidden &&
            (evalStepRegistry[slot.kind].isVisible?.({
                projectId,
                workflowId: getStepValue("invocation").id || undefined,
                evaluationType,
                preview,
                liveCompatibleEvaluatorsOnly,
                getEvaluationName,
                getStepValue,
                setStepValue: () => undefined,
                advanceFrom: () => undefined,
            }) ??
                true),
        [
            evaluationType,
            getEvaluationName,
            getStepValue,
            liveCompatibleEvaluatorsOnly,
            preview,
            projectId,
        ],
    )

    const baseContext = useMemo(
        () => ({
            projectId,
            workflowId: selectedWorkflowId || undefined,
            evaluationType,
            preview,
            liveCompatibleEvaluatorsOnly,
            getEvaluationName,
        }),
        [
            evaluationType,
            getEvaluationName,
            liveCompatibleEvaluatorsOnly,
            preview,
            projectId,
            selectedWorkflowId,
        ],
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

    const handleInvocationSelection = useCallback(
        (nextInvocation: InvocationStepValue) => {
            const nextValues = {...stepValuesRef.current, invocation: nextInvocation}
            const dependsOnInvocation = (slot: EvalStepSlot): boolean => {
                const dependencies = slot.dependsOn ?? []
                return dependencies.some((dependency) => {
                    if (dependency === "invocation") return true
                    const dependencySlot = resolvedSteps.find(
                        (candidate) => candidate.kind === dependency,
                    )
                    return dependencySlot ? dependsOnInvocation(dependencySlot) : false
                })
            }
            for (const slot of resolvedSteps) {
                if (slot.kind === "invocation" || !dependsOnInvocation(slot)) continue
                nextValues[slot.kind] = resolveSlotValue(slot) as never
            }
            updateStepValues(nextValues)
            const nextContext = {
                ...baseContext,
                workflowId: nextInvocation.id || undefined,
                getStepValue: <Kind extends EvalStepKind>(kind: Kind) =>
                    (nextValues[kind] ??
                        evalStepRegistry[kind].defaultValue) as EvalStepValueMap[Kind],
                setStepValue: () => undefined,
                advanceFrom: () => undefined,
            } as EvalStepContext
            const next = nextInvocation.id
                ? findNextEvaluationStep(
                      "invocation",
                      resolvedSteps,
                      evalStepEngineRegistry,
                      nextContext.getStepValue,
                      nextContext,
                      isVisible,
                  )
                : "invocation"
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
            if (kind === "invocation") {
                handleInvocationSelection(value as InvocationStepValue)
                return
            }
            updateStepValues((existing) => ({...existing, [kind]: value}))
        },
        [getStepValue, handleInvocationSelection, updateStepValues],
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
        appId: selectedWorkflowId || routeAppId || undefined,
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
        if (resolvedSteps.some((slot) => slot.kind === "traces")) {
            const traceCount = stepValues.traces?.length ?? 0
            return `trace-evaluation-${traceCount}-${traceCount === 1 ? "trace" : "traces"}`
        }
        if (resolvedSteps.some((slot) => slot.kind === "query")) {
            const query = stepValues.query as EvalStepValueMap["query"] | undefined
            return query?.name ? `${query.name}-eval` : "query-eval"
        }
        if (!revisionIds.length || !testset.name) return ""
        if (revisionIds.length > 1) return `${revisionIds.length}-variants-${testset.name}`
        const revision = filteredVariants.find((candidate) => candidate.id === revisionIds[0])
        if (!revision) return ""
        return `${selectedVariantLabel ?? revision.name ?? "-"}-v${revision.version ?? 0}-${testset.name}`
    }, [
        filteredVariants,
        nameBuilder,
        resolvedSteps,
        revisionIds,
        selectedVariantLabel,
        stepValues,
        testset.name,
    ])

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
                    !selectedWorkflowId ||
                    !selectionData.revisions.length ||
                    !selectionData.testset ||
                    !selectionData.evaluators.length
                ) {
                    message.error(
                        "Human evaluations require a workflow, revision, testset, and evaluator.",
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
                    appId: selectedWorkflowId,
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
            const startedLabel =
                runCount > 1 ? `${runCount} evaluations started.` : "Evaluation started."
            if (runId) {
                const resultsUrl = buildEvaluationNavigationUrl({
                    scope:
                        resolvedSteps.some((slot) => slot.kind === "invocation") && isAppScoped
                            ? "app"
                            : "project",
                    baseAppURL,
                    projectURL,
                    appId: selectedWorkflowId || undefined,
                    path: `/evaluations/results/${runId}`,
                })
                const successContent = (
                    <span>
                        {startedLabel}{" "}
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
                    </span>
                )
                message.success(successContent)
            } else {
                message.success(startedLabel)
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
        selectedWorkflowId,
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
            allowTestsetAutoAdvance,
            onEvaluatorCreated: handleEvaluatorCreated,
        }),
        [allowTestsetAutoAdvance, handleEvaluatorCreated],
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

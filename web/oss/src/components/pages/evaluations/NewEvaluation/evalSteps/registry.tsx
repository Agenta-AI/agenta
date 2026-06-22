import {memo, useCallback, useMemo} from "react"
import type {SetStateAction} from "react"

import {
    createSimpleQuery,
    invalidateQueryCache,
    queryHeadQueryKey,
    retrieveQueryRevision,
} from "@agenta/entities/query"
import {
    createEvaluatorFromTemplate,
    workflowMolecule,
    type EvaluatorCatalogTemplate,
} from "@agenta/entities/workflow"
import type {EvaluationStepDescriptorMap} from "@agenta/evaluations/core"
import {openWorkflowRevisionDrawerAtom} from "@agenta/playground-ui/workflow-revision-drawer"
import {queryClient} from "@agenta/shared/api"
import {message} from "@agenta/ui/app-message"
import {CloseCircleOutlined} from "@ant-design/icons"
import {Tag} from "antd"
import {useAtomValue, useSetAtom} from "jotai"

import {openHumanEvaluatorDrawerAtom} from "@/oss/components/Evaluators/Drawers/HumanEvaluatorDrawer/store"

import {DEFAULT_ADVANCE_SETTINGS} from "../assets/constants"
import AdvancedSettings from "../Components/AdvancedSettings"
import QuerySourceSection from "../Components/QuerySourceSection"
import SelectEvaluatorSection from "../Components/SelectEvaluatorSection/SelectEvaluatorSection"
import SelectTestsetSection from "../Components/SelectTestsetSection"
import SelectVariantSection from "../Components/SelectVariantSection"
import SelectWorkflowSection from "../Components/SelectWorkflowSection"
import TracesSourceSection from "../Components/TracesSourceSection"

import {buildTraceIdFilter} from "./sourceHelpers"
import type {
    ApplicationStepValue,
    EvalStepDescriptorRegistry,
    EvalStepContext,
    EvalStepKind,
    EvalStepSectionProps,
    SimpleEvaluationDataPayload,
    TestsetStepValue,
} from "./types"

const EMPTY_APPLICATION: ApplicationStepValue = {id: ""}
const EMPTY_TESTSET: TestsetStepValue = {
    id: "",
    revisionId: "",
    name: "",
    version: null,
}
const EMPTY_QUERY = {queryId: ""}

const ApplicationSection = ({value, slot, runtime}: EvalStepSectionProps<ApplicationStepValue>) => (
    <SelectWorkflowSection
        selectedWorkflowId={value.id}
        onSelectWorkflow={(id, meta) => {
            runtime.onSelectApplication({id, ...meta})
        }}
        disabled={slot.locked}
    />
)

const RevisionSection = ({value, context}: EvalStepSectionProps<string[]>) => (
    <SelectVariantSection
        selectedVariantRevisionIds={value}
        setSelectedVariantRevisionIds={(next) => {
            const resolved = typeof next === "function" ? next(value) : next
            context.setStepValue("revision", resolved)
        }}
        handlePanelChange={() => context.advanceFrom("revision")}
        evaluationType={context.evaluationType}
        className="pt-2"
    />
)

const TestsetSection = ({value, context, runtime}: EvalStepSectionProps<TestsetStepValue>) => {
    const revisionIds = context.getStepValue("revision")
    const selectedVariants = useMemo(
        () =>
            revisionIds
                .map((id) => workflowMolecule.get.data(id))
                .filter((workflow): workflow is NonNullable<typeof workflow> => Boolean(workflow)),
        [revisionIds],
    )

    return (
        <SelectTestsetSection
            selectedTestsetId={value.id}
            selectedTestsetRevisionId={value.revisionId}
            selectedTestsetName={value.name}
            selectedTestsetVersion={value.version}
            setSelectedTestsetId={(id) =>
                context.setStepValue("testset", (current) => ({
                    ...current,
                    id: resolveNext(id, current.id),
                }))
            }
            setSelectedTestsetRevisionId={(revisionId) =>
                context.setStepValue("testset", (current) => ({
                    ...current,
                    revisionId: resolveNext(revisionId, current.revisionId),
                }))
            }
            setSelectedTestsetName={(name) =>
                context.setStepValue("testset", (current) => ({
                    ...current,
                    name: resolveNext(name, current.name),
                }))
            }
            setSelectedTestsetVersion={(version) =>
                context.setStepValue("testset", (current) => ({
                    ...current,
                    version: resolveNext(version, current.version),
                }))
            }
            handlePanelChange={() => context.advanceFrom("testset")}
            selectedVariantRevisionIds={revisionIds}
            selectedVariants={selectedVariants}
            allowAutoAdvance={runtime.allowTestsetAutoAdvance}
            className="pt-2"
        />
    )
}

const EvaluatorSection = ({value, context, runtime}: EvalStepSectionProps<string[]>) => {
    const openEvaluatorDrawer = useSetAtom(openWorkflowRevisionDrawerAtom)
    const openHumanDrawer = useSetAtom(openHumanEvaluatorDrawerAtom)

    const handleCreateHumanEvaluator = useCallback(() => {
        openHumanDrawer({mode: "create", onSuccess: runtime.onEvaluatorCreated})
    }, [openHumanDrawer, runtime.onEvaluatorCreated])

    const handleSelectTemplate = useCallback(
        async (evaluator: EvaluatorCatalogTemplate) => {
            if (!evaluator.key) {
                message.error("Unable to open evaluator template")
                return
            }
            const localId = await createEvaluatorFromTemplate(evaluator.key)
            if (!localId) {
                message.error("Unable to create evaluator from template")
                return
            }
            openEvaluatorDrawer({
                entityId: localId,
                context: "evaluator-create",
                onEvaluatorCreated: runtime.onEvaluatorCreated,
            })
        },
        [openEvaluatorDrawer, runtime.onEvaluatorCreated],
    )

    return (
        <SelectEvaluatorSection
            selectedEvalConfigs={value}
            setSelectedEvalConfigs={(next) => {
                const resolved = typeof next === "function" ? next(value) : next
                context.setStepValue("evaluator", resolved)
            }}
            preview={context.preview}
            selectedAppId={context.appId}
            liveCompatibleEvaluatorsOnly={context.liveCompatibleEvaluatorsOnly}
            onSelectTemplate={handleSelectTemplate}
            onCreateHumanEvaluator={handleCreateHumanEvaluator}
            className="pt-2"
        />
    )
}

const AdvancedSection = ({
    value,
    context,
}: EvalStepSectionProps<typeof DEFAULT_ADVANCE_SETTINGS>) => (
    <AdvancedSettings
        advanceSettings={value}
        setAdvanceSettings={(next) => {
            const resolved = typeof next === "function" ? next(value) : next
            context.setStepValue("advanced", resolved)
        }}
    />
)

const resolveNext = <Value,>(next: SetStateAction<Value>, current: Value) =>
    typeof next === "function" ? (next as (value: Value) => Value)(current) : next

interface RevisionLike {
    id?: string | null
    name?: string | null
    version?: number | null
}

const RevisionLabel = memo(({revision}: {revision: RevisionLike}) => {
    const variantLabel = useAtomValue(workflowMolecule.selectors.variantLabel(revision.id ?? ""))
    return <>{`${variantLabel ?? revision.name ?? "-"} - v${revision.version ?? 0}`}</>
})

const EvaluatorLabel = memo(({id}: {id: string}) => {
    const artifactName = useAtomValue(workflowMolecule.selectors.artifactName(id))
    const revision = workflowMolecule.get.data(id)
    return <>{`${artifactName ?? revision?.name ?? "-"} - v${revision?.version ?? 0}`}</>
})

export const evalStepRegistry: EvalStepDescriptorRegistry = {
    application: {
        kind: "application",
        title: "Application",
        Section: ApplicationSection,
        defaultValue: EMPTY_APPLICATION,
        isComplete: (value) => Boolean(value.id),
        renderSummary: (value, context, slot) =>
            value.id ? (
                <Tag
                    closable={!slot.locked}
                    closeIcon={<CloseCircleOutlined />}
                    onClose={() => context.setStepValue("application", EMPTY_APPLICATION)}
                >
                    {value.label ?? value.id}
                </Tag>
            ) : null,
        toPayload: async (_value, context) => ({
            application_steps: Object.fromEntries(
                context.getStepValue("revision").map((id) => [id, "auto" as const]),
            ),
        }),
        incompleteMessage: "Please select an application",
    },
    revision: {
        kind: "revision",
        title: "Revision",
        Section: RevisionSection,
        defaultValue: [],
        isComplete: (value) => value.length > 0,
        renderSummary: (value, context, slot) =>
            value.map((id) => {
                const revision = workflowMolecule.get.data(id)
                return (
                    <Tag
                        key={id}
                        closable={!slot.locked}
                        closeIcon={<CloseCircleOutlined />}
                        onClose={() =>
                            context.setStepValue(
                                "revision",
                                value.filter((revisionId) => revisionId !== id),
                            )
                        }
                    >
                        <RevisionLabel revision={revision ?? {id}} />
                    </Tag>
                )
            }),
        incompleteMessage: "Please select a revision",
    },
    testset: {
        kind: "testset",
        title: "Test set",
        Section: TestsetSection,
        defaultValue: EMPTY_TESTSET,
        isComplete: (value) => Boolean(value.id && value.revisionId),
        renderSummary: (value, context, slot) =>
            value.name ? (
                <Tag
                    closable={!slot.locked}
                    closeIcon={<CloseCircleOutlined />}
                    onClose={() => context.setStepValue("testset", EMPTY_TESTSET)}
                >
                    {value.name}
                    {typeof value.version === "number" ? ` - v${value.version}` : null}
                </Tag>
            ) : null,
        toPayload: async (value) => ({
            testset_steps: value.revisionId ? {[value.revisionId]: "auto"} : undefined,
        }),
        incompleteMessage: "Please select a testset revision",
    },
    evaluator: {
        kind: "evaluator",
        title: "Evaluators",
        Section: EvaluatorSection,
        defaultValue: [],
        isComplete: (value) => value.length > 0,
        renderSummary: (value, context, slot) =>
            value.map((id) => (
                <Tag
                    key={id}
                    closable={!slot.locked}
                    closeIcon={<CloseCircleOutlined />}
                    onClose={() =>
                        context.setStepValue(
                            "evaluator",
                            value.filter((evaluatorId) => evaluatorId !== id),
                        )
                    }
                >
                    <EvaluatorLabel id={id} />
                </Tag>
            )),
        toPayload: async (value) => ({
            evaluator_steps: Object.fromEntries(value.map((id) => [id, "auto" as const])),
        }),
        incompleteMessage: "Please select evaluator configuration",
    },
    advanced: {
        kind: "advanced",
        title: "Advanced Settings",
        Section: AdvancedSection,
        defaultValue: DEFAULT_ADVANCE_SETTINGS,
        isComplete: () => true,
        isVisible: (context) => context.evaluationType === "auto",
        renderSummary: (value) =>
            Object.entries(value).map(([key, setting]) => (
                <Tag key={key} className="max-w-[200px] truncate">
                    {key}: {setting}
                </Tag>
            )),
        toPayload: async (value) => ({concurrency: value}),
        incompleteMessage: "Please complete advanced settings",
    },
    traces: {
        kind: "traces",
        title: "Traces",
        Section: TracesSourceSection,
        defaultValue: [],
        isComplete: (value) => value.length > 0,
        renderSummary: (value, context, slot) =>
            value.length ? (
                <Tag
                    closable={!slot.locked}
                    closeIcon={<CloseCircleOutlined />}
                    onClose={() => context.setStepValue("traces", [])}
                >
                    {value.length} trace{value.length === 1 ? "" : "s"}
                </Tag>
            ) : null,
        toPayload: async (value, context) => {
            if (!context.projectId) {
                throw new Error("A project is required to create a trace-backed evaluation.")
            }
            if (!value.length) {
                throw new Error("Select at least one trace before creating an evaluation.")
            }
            const {revisionId} = await createSimpleQuery({
                projectId: context.projectId,
                query: {
                    name: "trace-eval",
                    data: {filtering: buildTraceIdFilter(value)},
                },
            })
            invalidateQueryCache()
            return {query_steps: {[revisionId]: "auto"}}
        },
        incompleteMessage: "Select at least one trace",
    },
    query: {
        kind: "query",
        title: "Query",
        Section: QuerySourceSection,
        defaultValue: EMPTY_QUERY,
        isComplete: (value) => Boolean(value.queryId),
        renderSummary: (value, context, slot) =>
            value.queryId ? (
                <Tag
                    closable={!slot.locked}
                    closeIcon={<CloseCircleOutlined />}
                    onClose={() => context.setStepValue("query", EMPTY_QUERY)}
                >
                    {value.name ?? value.queryId}
                </Tag>
            ) : null,
        toPayload: async (value, context) => {
            if (!context.projectId) {
                throw new Error("A project is required to create a query-backed evaluation.")
            }
            if (!value.queryId) {
                throw new Error("Select a query before creating an evaluation.")
            }
            const queryKey = queryHeadQueryKey(context.projectId, value.queryId)
            const revision =
                queryClient.getQueryData<Awaited<ReturnType<typeof retrieveQueryRevision>>>(
                    queryKey,
                ) ??
                (await retrieveQueryRevision({
                    projectId: context.projectId,
                    queryRef: {id: value.queryId},
                }))
            if (!revision?.id) {
                throw new Error("Unable to resolve the selected query revision.")
            }
            return {query_steps: {[revision.id]: "auto"}}
        },
        incompleteMessage: "Select a query",
    },
}

export const evalStepEngineRegistry = evalStepRegistry as unknown as EvaluationStepDescriptorMap<
    EvalStepKind,
    EvalStepContext,
    SimpleEvaluationDataPayload
>

export const EVAL_STEP_KINDS = new Set(
    Object.keys(evalStepRegistry) as (keyof typeof evalStepRegistry)[],
)

export const getDefaultEvalSteps = (): import("./types").EvalStepSlot[] => [
    {kind: "application", required: false},
    {kind: "revision", required: false, dependsOn: ["application"]},
    {kind: "testset", required: false, dependsOn: ["application"]},
    {kind: "evaluator", required: true, dependsOn: ["application"]},
    {kind: "advanced", required: true},
]

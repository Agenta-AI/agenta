import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {workspaceMembersAtom} from "@agenta/entities/shared"
import {
    createSimpleQueueAtom,
    simpleQueueMolecule,
    type CreateSimpleQueuePayload,
} from "@agenta/entities/simpleQueue"
import {type WorkflowRevisionSelectionResult} from "@agenta/entity-ui/selection"
import {projectIdAtom} from "@agenta/shared/state"
import {ModalContent, ModalFooter, message} from "@agenta/ui"
import {Divider, Drawer, Form, Input, InputNumber, Select, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"

import {EntityEvaluatorSelector} from "./EntityEvaluatorSelector"
import SelectedEvaluatorCard, {type SelectedEvaluatorCardData} from "./SelectedEvaluatorCard"

interface SelectedEvaluator extends SelectedEvaluatorCardData {
    evaluatorId: string
    revisionId: string
}

type AnnotationEvaluatorSelection = WorkflowRevisionSelectionResult & {
    metadata: WorkflowRevisionSelectionResult["metadata"] & {
        workflowId?: string
        isHuman?: boolean
    }
}

interface FormValues {
    name: string
    kind: "traces" | "testcases"
    description?: string
    repeats: number
    assignments?: string[][]
    batch_size?: number | null
    batch_offset?: number | null
}

interface CreateQueueDrawerContentProps {
    isSubmitting: boolean
    onClose: () => void
    onSetSubmitting: (next: boolean) => void
    onRegisterSubmit: (submit: (() => void) | null) => void
    defaultKind: "traces" | "testcases"
    selection: {itemType: "traces" | "testcases"; itemIds: string[]} | null
    onClearSelection: () => void
    onItemsAdded?: () => void
}

const INITIAL_FORM_VALUES: Pick<FormValues, "kind" | "repeats"> = {
    kind: "traces",
    repeats: 1,
}

const COMPACT_FORM_ITEM_CLASS = "!mb-0"

function SectionTitle({children}: {children: React.ReactNode}) {
    return (
        <Typography.Title level={5} className="!m-0 !font-semibold">
            {children}
        </Typography.Title>
    )
}

function FieldLabel({
    children,
    description,
}: {
    children: React.ReactNode
    description?: React.ReactNode
}) {
    return (
        <div className="flex flex-col">
            <Typography.Text strong>{children}</Typography.Text>
            {description ? (
                <Typography.Text type="secondary" className="!text-xs !leading-5">
                    {description}
                </Typography.Text>
            ) : null}
        </div>
    )
}

function CreateQueueDrawerContent({
    isSubmitting,
    onClose,
    onSetSubmitting,
    onRegisterSubmit,
    defaultKind,
    selection,
    onClearSelection,
    onItemsAdded,
}: CreateQueueDrawerContentProps) {
    const projectId = useAtomValue(projectIdAtom)
    const members = useAtomValue(workspaceMembersAtom)
    const createQueue = useSetAtom(createSimpleQueueAtom)
    const addTraces = useSetAtom(simpleQueueMolecule.actions.addTraces)
    const addTestcases = useSetAtom(simpleQueueMolecule.actions.addTestcases)
    const [form] = Form.useForm<FormValues>()
    const [selectedEvaluators, setSelectedEvaluators] = useState<SelectedEvaluator[]>([])

    const repeats = Math.max(Form.useWatch("repeats", form) ?? INITIAL_FORM_VALUES.repeats, 1)
    const hasHumanEvaluatorSelected = selectedEvaluators.some((evaluator) => evaluator.isHuman)
    const selectedRevisionIds = useMemo(
        () => new Set(selectedEvaluators.map((evaluator) => evaluator.revisionId)),
        [selectedEvaluators],
    )
    const latestSelectedEvaluator = selectedEvaluators[selectedEvaluators.length - 1] ?? null

    useEffect(() => {
        if (!hasHumanEvaluatorSelected) {
            form.setFieldValue("assignments", undefined)
        }
    }, [form, hasHumanEvaluatorSelected])

    useEffect(() => {
        form.setFieldValue("kind", selection?.itemType ?? defaultKind)
    }, [defaultKind, form, selection])

    const memberOptions = useMemo(
        () =>
            members
                .filter((member) => member.user.id)
                .map((member) => ({
                    value: member.user.id!,
                    label: member.user.username || member.user.email || member.user.id!,
                })),
        [members],
    )

    const hasMembersAvailable = memberOptions.length > 0

    const requestSubmit = useCallback(() => {
        form.submit()
    }, [form])

    useEffect(() => {
        onRegisterSubmit(requestSubmit)
        return () => {
            onRegisterSubmit(null)
        }
    }, [onRegisterSubmit, requestSubmit])

    const handleEvaluatorSelect = useCallback((selection: WorkflowRevisionSelectionResult) => {
        const {id, metadata} = selection as AnnotationEvaluatorSelection

        setSelectedEvaluators((prev) => {
            if (prev.some((evaluator) => evaluator.revisionId === id)) {
                return prev
            }

            return [
                ...prev,
                {
                    evaluatorId: metadata.workflowId || "",
                    revisionId: id,
                    evaluatorName: metadata.workflowName || "Evaluator",
                    version: metadata.revision ?? 0,
                    isHuman: Boolean(metadata.isHuman),
                },
            ]
        })
    }, [])

    const handleRemoveEvaluator = useCallback((revisionId: string) => {
        setSelectedEvaluators((prev) =>
            prev.filter((evaluator) => evaluator.revisionId !== revisionId),
        )
    }, [])

    const handleFinish = useCallback(
        async (values: FormValues) => {
            if (!projectId) {
                message.error("Project is not available")
                return
            }

            onSetSubmitting(true)

            try {
                const normalizedRepeats = Math.max(values.repeats ?? 1, 1)
                if (selection && values.kind !== selection.itemType) {
                    message.error(
                        `Selected ${selection.itemType === "traces" ? "traces" : "test cases"} can only be added to a ${selection.itemType} queue`,
                    )
                    onSetSubmitting(false)
                    return
                }

                const evaluatorRevisionIds = selectedEvaluators.map(
                    (evaluator) => evaluator.revisionId,
                )

                const nonEmptyAssignments = hasHumanEvaluatorSelected
                    ? (values.assignments ?? [])
                          .slice(0, normalizedRepeats)
                          .map((row) => (row ?? []).filter(Boolean))
                          .filter((row) => row.length > 0)
                    : []

                const payload: CreateSimpleQueuePayload = {
                    name: values.name,
                    description: values.description || null,
                    data: {
                        kind: values.kind,
                        evaluators:
                            evaluatorRevisionIds.length > 0 ? evaluatorRevisionIds : undefined,
                        repeats: normalizedRepeats > 1 ? normalizedRepeats : undefined,
                        assignments:
                            hasHumanEvaluatorSelected && nonEmptyAssignments.length > 0
                                ? nonEmptyAssignments
                                : undefined,
                        settings:
                            values.batch_size != null || values.batch_offset != null
                                ? {
                                      batch_size: values.batch_size ?? null,
                                      batch_offset: values.batch_offset ?? null,
                                  }
                                : undefined,
                    },
                }

                const result = await createQueue(payload)

                if (!result) {
                    message.error("Failed to create annotation queue")
                    onSetSubmitting(false)
                    return
                }

                if (selection?.itemIds.length) {
                    const attachResult =
                        selection.itemType === "traces"
                            ? await addTraces(result.id, selection.itemIds)
                            : await addTestcases(result.id, selection.itemIds)

                    if (!attachResult) {
                        onClearSelection()
                        onSetSubmitting(false)
                        onClose()
                        message.error(
                            `Queue was created, but failed to add the selected ${selection.itemType === "traces" ? "traces" : "test cases"}`,
                        )
                        return
                    }

                    onItemsAdded?.()
                }

                onClearSelection()
                message.success("Annotation queue created")
                onSetSubmitting(false)
                onClose()
            } catch (error) {
                if (error instanceof Error) {
                    message.error(error.message)
                }
                onSetSubmitting(false)
            }
        },
        [
            addTestcases,
            addTraces,
            createQueue,
            hasHumanEvaluatorSelected,
            onClose,
            onClearSelection,
            onItemsAdded,
            onSetSubmitting,
            projectId,
            selectedEvaluators,
            selection,
        ],
    )

    return (
        <Form<FormValues>
            form={form}
            layout="vertical"
            initialValues={{...INITIAL_FORM_VALUES, kind: defaultKind}}
            onFinish={handleFinish}
            disabled={isSubmitting}
            requiredMark={false}
        >
            <ModalContent className="flex flex-col">
                {/* ── Basic details ── */}
                <div className="flex flex-col gap-4 px-6 py-3">
                    <SectionTitle>Basic details</SectionTitle>

                    <Form.Item
                        className={COMPACT_FORM_ITEM_CLASS}
                        name="name"
                        label={<FieldLabel>Annotation name</FieldLabel>}
                        rules={[{required: true, message: "Name is required"}]}
                    >
                        <Input placeholder="Enter name" />
                    </Form.Item>

                    <Form.Item
                        className={COMPACT_FORM_ITEM_CLASS}
                        name="kind"
                        label={<FieldLabel>Queue type</FieldLabel>}
                        rules={[{required: true, message: "Type is required"}]}
                    >
                        <Select
                            options={[
                                {label: "Traces", value: "traces"},
                                {label: "Test cases", value: "testcases"},
                            ]}
                            disabled={Boolean(selection)}
                        />
                    </Form.Item>

                    <Form.Item
                        className={COMPACT_FORM_ITEM_CLASS}
                        name="description"
                        label={<FieldLabel>Description</FieldLabel>}
                    >
                        <Input.TextArea
                            rows={2}
                            placeholder="Enter description or reviewer guidance"
                        />
                    </Form.Item>
                </div>

                <Divider className="!m-0" />

                {/* ── Annotation details ── */}
                <div className="flex flex-col gap-4 px-6 py-3">
                    <SectionTitle>Annotation details</SectionTitle>

                    <div className="flex flex-col gap-2">
                        <FieldLabel>Feedback</FieldLabel>
                        <div className="flex flex-col gap-3">
                            <EntityEvaluatorSelector
                                onSelect={handleEvaluatorSelect}
                                instanceId="queue-evaluator"
                                disabled={isSubmitting}
                                disabledRevisionIds={selectedRevisionIds}
                                selectedEvaluatorId={latestSelectedEvaluator?.evaluatorId ?? null}
                                selectedRevisionId={latestSelectedEvaluator?.revisionId ?? null}
                                openVersionOnHover
                            />
                            {selectedEvaluators.map((evaluator) => (
                                <SelectedEvaluatorCard
                                    key={evaluator.revisionId}
                                    evaluator={evaluator}
                                    onRemove={handleRemoveEvaluator}
                                    disabled={isSubmitting}
                                />
                            ))}
                        </div>
                    </div>
                </div>

                <Divider className="!m-0" />

                {/* ── Collaborator settings ── */}
                <div className="flex flex-col gap-4 px-6 py-4">
                    <SectionTitle>Collaborator settings</SectionTitle>

                    <Form.Item
                        className={COMPACT_FORM_ITEM_CLASS}
                        name="repeats"
                        label={
                            <FieldLabel description="Reviewers required to mark a trace as 'Done'">
                                Number of reviews per run
                            </FieldLabel>
                        }
                    >
                        <InputNumber min={1} className="w-full" />
                    </Form.Item>

                    <div className="flex flex-col gap-3">
                        {Array.from({length: repeats}, (_, index) => (
                            <Form.Item
                                className={COMPACT_FORM_ITEM_CLASS}
                                key={index}
                                name={["assignments", index]}
                                preserve={false}
                                label={
                                    <FieldLabel
                                        description={
                                            !hasHumanEvaluatorSelected
                                                ? "Select a human evaluator to enable assignee routing"
                                                : undefined
                                        }
                                    >
                                        {repeats > 1
                                            ? `Repeat ${index + 1} - Assignees`
                                            : "Assignees"}
                                    </FieldLabel>
                                }
                            >
                                <Select
                                    mode="multiple"
                                    placeholder={
                                        !hasHumanEvaluatorSelected
                                            ? "Requires human evaluator"
                                            : hasMembersAvailable
                                              ? "All members (leave empty for unassigned)"
                                              : "Available on annotations page"
                                    }
                                    options={memberOptions}
                                    allowClear
                                    disabled={
                                        !hasHumanEvaluatorSelected ||
                                        !hasMembersAvailable ||
                                        isSubmitting
                                    }
                                />
                            </Form.Item>
                        ))}
                    </div>
                </div>
            </ModalContent>
        </Form>
    )
}

interface CreateQueueDrawerProps {
    onItemsAdded?: () => void
}

const CreateQueueDrawer = ({onItemsAdded}: CreateQueueDrawerProps) => {
    const [open, setOpen] = useAtom(createQueueDrawerOpenAtom)
    const defaultKind = useAtomValue(createQueueDrawerDefaultKindAtom)
    const [selection, setSelection] = useAtom(createQueueDrawerSelectionAtom)
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [shouldRenderContent, setShouldRenderContent] = useState(false)
    const submitRef = useRef<(() => void) | null>(null)

    useEffect(() => {
        if (open) {
            setShouldRenderContent(true)
        }
    }, [open])

    const handleClose = useCallback(() => {
        if (isSubmitting) return
        setSelection(null)
        setOpen(false)
    }, [isSubmitting, setOpen, setSelection])

    const handleAfterOpenChange = useCallback((nextOpen: boolean) => {
        if (!nextOpen) {
            setShouldRenderContent(false)
            setIsSubmitting(false)
            submitRef.current = null
        }
    }, [])

    const handleRegisterSubmit = useCallback((submit: (() => void) | null) => {
        submitRef.current = submit
    }, [])

    const handleSubmit = useCallback(() => {
        submitRef.current?.()
    }, [])

    const handleClearSelection = useCallback(() => {
        setSelection(null)
    }, [setSelection])

    return (
        <Drawer
            title="Create annotation queue"
            open={open}
            onClose={handleClose}
            afterOpenChange={handleAfterOpenChange}
            destroyOnHidden
            closable={!isSubmitting}
            maskClosable={!isSubmitting}
            width={640}
            styles={{
                body: {padding: 0},
                footer: {padding: "12px 16px"},
            }}
            footer={
                shouldRenderContent ? (
                    <ModalFooter
                        onCancel={handleClose}
                        onConfirm={handleSubmit}
                        confirmLabel="Create"
                        isLoading={isSubmitting}
                    />
                ) : null
            }
        >
            {shouldRenderContent ? (
                <CreateQueueDrawerContent
                    isSubmitting={isSubmitting}
                    onClose={handleClose}
                    onSetSubmitting={setIsSubmitting}
                    onRegisterSubmit={handleRegisterSubmit}
                    defaultKind={defaultKind}
                    selection={selection}
                    onClearSelection={handleClearSelection}
                    onItemsAdded={onItemsAdded}
                />
            ) : null}
        </Drawer>
    )
}

export default CreateQueueDrawer

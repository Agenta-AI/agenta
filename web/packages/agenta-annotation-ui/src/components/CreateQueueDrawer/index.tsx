import {useCallback, useEffect, useMemo, useRef, useState} from "react"

import {workspaceMembersAtom} from "@agenta/entities/shared"
import {
    createSimpleQueueAtom,
    simpleQueueMolecule,
    type CreateSimpleQueuePayload,
} from "@agenta/entities/simpleQueue"
import {
    EntityPicker,
    type EntitySelectionResult,
    useEnrichedAnnotationEvaluatorAdapter,
    type WorkflowRevisionSelectionResult,
} from "@agenta/entity-ui/selection"
import {projectIdAtom} from "@agenta/shared/state"
import {ModalContent, ModalFooter, VersionBadge, message} from "@agenta/ui"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import {Button, Divider, Drawer, Form, Input, InputNumber, Select, Typography} from "antd"
import {useAtom, useAtomValue, useSetAtom} from "jotai"

import {
    createQueueDrawerOpenAtom,
    createQueueDrawerDefaultKindAtom,
    createQueueDrawerSelectionAtom,
} from "../../state/atoms"

interface EvaluatorSlot {
    /** Revision ID sent to backend */
    revisionId: string | undefined
    label: string | undefined
    isHuman: boolean
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

function createInitialEvaluatorSlots(): EvaluatorSlot[] {
    return [{revisionId: undefined, label: undefined, isHuman: false}]
}

function isHumanEvaluatorSelection(selection: EntitySelectionResult): boolean {
    const metadata = selection.metadata as
        | {isHuman?: boolean; flags?: {is_human?: boolean} | null}
        | undefined

    return Boolean(metadata?.isHuman ?? metadata?.flags?.is_human)
}

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
    const evaluatorAdapter = useEnrichedAnnotationEvaluatorAdapter()
    const [form] = Form.useForm<FormValues>()
    const [evaluatorSlots, setEvaluatorSlots] = useState<EvaluatorSlot[]>(
        createInitialEvaluatorSlots,
    )

    const repeats = Math.max(Form.useWatch("repeats", form) ?? INITIAL_FORM_VALUES.repeats, 1)
    const hasHumanEvaluatorSelected = evaluatorSlots.some(
        (slot) => Boolean(slot.revisionId) && slot.isHuman,
    )

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

    const handleEvaluatorSelect = useCallback((index: number, selection: EntitySelectionResult) => {
        setEvaluatorSlots((prev) => {
            const next = [...prev]
            next[index] = {
                revisionId: selection.id,
                label: selection.label,
                isHuman: isHumanEvaluatorSelection(selection),
            }
            return next
        })
    }, [])

    const evaluatorDisplayRender = useCallback((labels: string[]) => {
        if (labels.length === 0) return ""
        const revisionLabel = labels[labels.length - 1]
        const parentLabels = labels.slice(0, -1)
        const versionMatch = /^v(\d+)/.exec(revisionLabel)
        if (versionMatch) {
            return (
                <span className="inline-flex items-center gap-1.5">
                    {parentLabels.length > 0 ? <span>{parentLabels.join(" / ")}</span> : null}
                    <VersionBadge version={Number(versionMatch[1])} variant="chip" size="small" />
                </span>
            )
        }
        return labels.join(" / ")
    }, [])

    const handleAddEvaluator = useCallback(() => {
        setEvaluatorSlots((prev) => [...prev, ...createInitialEvaluatorSlots()])
    }, [])

    const handleRemoveEvaluator = useCallback((index: number) => {
        setEvaluatorSlots((prev) => prev.filter((_, slotIndex) => slotIndex !== index))
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

                const evaluatorRevisionIds = evaluatorSlots
                    .map((slot) => slot.revisionId)
                    .filter((id): id is string => Boolean(id))

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
            evaluatorSlots,
            hasHumanEvaluatorSelected,
            onClose,
            onClearSelection,
            onItemsAdded,
            onSetSubmitting,
            projectId,
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
                <div className="flex flex-col gap-4 px-6 py-6">
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
                        style={{marginTop: 16}}
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
                        style={{marginTop: 16}}
                    >
                        <Input.TextArea
                            rows={2}
                            placeholder="Enter description or reviewer guidance"
                        />
                    </Form.Item>
                </div>

                <Divider className="!m-0" />

                {/* ── Annotation details ── */}
                <div className="flex flex-col gap-4 px-6 py-6">
                    <SectionTitle>Annotation details</SectionTitle>

                    <div className="flex flex-col gap-2">
                        <FieldLabel>Feedback</FieldLabel>
                        <div className="flex flex-col gap-2">
                            {evaluatorSlots.map((slot, index) => (
                                <div key={index} className="flex items-center gap-1.5">
                                    <div className="min-w-0 flex-1">
                                        <EntityPicker<WorkflowRevisionSelectionResult>
                                            variant="cascader"
                                            adapter={evaluatorAdapter}
                                            onSelect={(selection) =>
                                                handleEvaluatorSelect(index, selection)
                                            }
                                            size="middle"
                                            placeholder={slot.label ?? "Select evaluator..."}
                                            instanceId={`queue-evaluator-${index}`}
                                            className="!w-full"
                                            displayRender={evaluatorDisplayRender}
                                        />
                                    </div>
                                    {evaluatorSlots.length > 1 ? (
                                        <Button
                                            type="text"
                                            size="small"
                                            icon={<MinusCircle size={16} />}
                                            onClick={() => handleRemoveEvaluator(index)}
                                            disabled={isSubmitting}
                                            className="!flex !h-8 !w-8 !items-center !justify-center !p-0"
                                        />
                                    ) : null}
                                </div>
                            ))}
                        </div>
                        <div>
                            <Button
                                type="dashed"
                                size="small"
                                icon={<Plus size={14} />}
                                onClick={handleAddEvaluator}
                                disabled={isSubmitting}
                            >
                                Add annotation
                            </Button>
                        </div>
                    </div>
                </div>

                <Divider className="!m-0" />

                {/* ── Collaborator settings ── */}
                <div className="flex flex-col gap-4 px-6 py-6">
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

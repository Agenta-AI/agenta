import {useCallback, useEffect, useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {Plus} from "@phosphor-icons/react"
import {Alert, Button, Form, Input, Typography} from "antd"
import {useSetAtom} from "jotai"
import {useDebounceValue} from "usehooks-ts"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {EvaluatorPreviewDto} from "@/oss/lib/hooks/useEvaluators/types"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {createEvaluator, updateEvaluator} from "@/oss/services/evaluators"

import {AnnotateDrawerSteps} from "../enum"
import {generateNewEvaluatorPayloadData} from "../transforms"
import {CreateEvaluatorProps} from "../types"

import CreateNewMetric from "./assets/CreateNewMetric"
import {slugify} from "./assets/helper"
import {MetricFormData} from "./assets/types"

type EvaluatorWithMeta = EvaluatorPreviewDto & {
    id?: string
    flags?: Record<string, any>
    meta?: Record<string, any>
    tags?: Record<string, any>
}

const defaultMetric = {name: "", optional: false}

const CreateEvaluator = ({
    setSteps,
    setSelectedEvaluators,
    mode = "create",
    evaluator,
    onSuccess,
    skipPostCreateStepChange = false,
}: CreateEvaluatorProps) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string[]>([])
    const [slugTouched, setSlugTouched] = useState(false)

    console.log("CreateEvaluator")
    const [form] = Form.useForm()
    const name = Form.useWatch("evaluatorName", form)
    const slugValue = Form.useWatch("evaluatorSlug", form)
    const [debouncedName] = useDebounceValue(name, 500)
    const {mutate} = useEvaluators({
        preview: true,
        queries: {is_human: true},
    })
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const isEditMode = mode === "edit" && Boolean(evaluator?.id)

    const metricsFromEvaluator = useMemo(() => {
        if (!isEditMode || !evaluator) return []

        const outputs =
            evaluator.data?.service?.format?.properties?.outputs ||
            (evaluator as EvaluatorWithMeta)?.data?.service?.format?.properties?.outputs

        if (!outputs || typeof outputs !== "object") return []

        const required = Array.isArray(outputs.required) ? outputs.required : []
        const properties = outputs.properties ?? {}

        return Object.entries(properties).map(([metricName, schema]) => {
            const metricSchema = schema as Record<string, any>
            const optional = !required.includes(metricName)

            if (Array.isArray(metricSchema.anyOf) && metricSchema.anyOf.length > 0) {
                const first = metricSchema.anyOf[0] || {}
                const enums = Array.isArray(first.enum)
                    ? first.enum.filter((value: any) => value !== null && value !== undefined)
                    : []
                return {
                    name: metricName,
                    type: "class",
                    enum: enums.map(String).filter(Boolean),
                    optional,
                }
            }

            if (metricSchema.type === "array") {
                const items = metricSchema.items || {}
                const enums = Array.isArray(items.enum)
                    ? items.enum.filter((value: any) => value !== null && value !== undefined)
                    : []
                return {
                    name: metricName,
                    type: "label",
                    enum: enums.map(String).filter(Boolean),
                    optional,
                }
            }

            const metric: Record<string, any> = {
                name: metricName,
                type: metricSchema.type,
                optional,
            }

            if (metricSchema.minimum !== undefined) {
                metric.minimum = metricSchema.minimum
            }

            if (metricSchema.maximum !== undefined) {
                metric.maximum = metricSchema.maximum
            }

            if (Array.isArray(metricSchema.enum)) {
                metric.enum = metricSchema.enum.filter(
                    (value: any) => value !== null && value !== undefined,
                )
            }

            return metric
        })
    }, [evaluator, isEditMode])

    const initialFormValues = useMemo(() => {
        const metrics =
            metricsFromEvaluator.length > 0
                ? metricsFromEvaluator.map((metric) => ({...metric}))
                : [{...defaultMetric}]

        if (!isEditMode) {
            return {
                evaluatorName: "",
                evaluatorSlug: "",
                evaluatorDescription: "",
                metrics,
            }
        }

        return {
            evaluatorName: evaluator?.name || "",
            evaluatorSlug: evaluator?.slug || "",
            evaluatorDescription: evaluator?.description || "",
            metrics,
        }
    }, [evaluator, isEditMode, metricsFromEvaluator])

    useEffect(() => {
        form.setFieldsValue({metrics: []})
        form.setFieldsValue(initialFormValues)
        setErrorMessage([])
        setSlugTouched(isEditMode)
    }, [form, initialFormValues, isEditMode])

    useEffect(() => {
        if (isEditMode) return
        if (slugTouched) return

        const nextSlug = slugify(debouncedName || "")
        if (slugValue !== nextSlug) {
            form.setFieldValue("evaluatorSlug", nextSlug)
        }
    }, [debouncedName, slugTouched, form, slugValue, isEditMode])

    const onScrollTo = useCallback((direction: "top" | "bottom") => {
        setTimeout(() => {
            const el = document.querySelector(".create-eval")
            if (el) {
                el.scrollTo({
                    top: direction === "top" ? 0 : el.scrollHeight,
                    behavior: "smooth",
                })
            }
        }, 100)
    }, [])

    const normalizeTags = (input: unknown): Record<string, unknown> | null => {
        if (input == null) return null
        if (Array.isArray(input)) return {}
        if (typeof input === "object") return input as Record<string, unknown>
        return {}
    }

    const onFinish = useCallback(
        async (values: any) => {
            try {
                setIsSubmitting(true)

                const metricsData: MetricFormData[] = values.metrics
                const payloadData = generateNewEvaluatorPayloadData({
                    metrics: metricsData,
                    evaluatorName: values.evaluatorName,
                    evaluatorSlug: values.evaluatorSlug,
                    evaluatorDescription: values.evaluatorDescription,
                })

                if (!payloadData.evaluator) return

                if (isEditMode && evaluator?.id) {
                    const evaluatorWithMeta = evaluator as EvaluatorWithMeta
                    const payload = {
                        evaluator: {
                            ...payloadData.evaluator,
                            id: evaluator.id,
                            flags: {
                                ...(evaluatorWithMeta.flags || {}),
                                is_human: true,
                                is_custom: false,
                            },
                            meta: evaluatorWithMeta.meta || {},
                            ...(evaluatorWithMeta.tags
                                ? {tags: normalizeTags(evaluatorWithMeta.tags)}
                                : {}),
                        },
                    }

                    await updateEvaluator(evaluator.id, payload)
                    await mutate()
                    message.success("Evaluator updated successfully")
                    await onSuccess?.(payload.evaluator.slug)
                    return
                }

                await createEvaluator(payloadData)
                await mutate()

                message.success("Evaluator created successfully")
                recordWidgetEvent("evaluator_created")
                if (!skipPostCreateStepChange) {
                    setSteps?.(AnnotateDrawerSteps.SELECT_EVALUATORS)
                    setSelectedEvaluators?.((prev) => [
                        ...new Set([...prev, payloadData.evaluator.slug]),
                    ])
                }
                await onSuccess?.(payloadData.evaluator.slug)
            } catch (error: any) {
                if (error?.response?.status === 409) {
                    setErrorMessage(["Evaluator with this slug already exists"])
                    message.error("Evaluator with this slug already exists")
                    onScrollTo("top")
                } else {
                    const errorMessages = Array.isArray(error?.response?.data?.detail)
                        ? error.response?.data?.detail
                              ?.map((item: any) => item?.msg)
                              .filter(Boolean)
                        : [error?.response?.data?.detail]

                    onScrollTo("top")
                    setErrorMessage((errorMessages || []).filter(Boolean))
                }
            } finally {
                setIsSubmitting(false)
            }
        },
        [
            mutate,
            setErrorMessage,
            onScrollTo,
            setSteps,
            setSelectedEvaluators,
            isEditMode,
            evaluator,
            onSuccess,
            skipPostCreateStepChange,
        ],
    )

    const submitLabel = isEditMode ? "Update" : "Create"

    return (
        <Form
            scrollToFirstError
            form={form}
            layout="vertical"
            onFinish={onFinish}
            onKeyDown={(e) => {
                if (e.key === "Enter") {
                    e.preventDefault()
                }
            }}
            className="create-eval h-full flex flex-col overflow-y-auto gap-4 p-4"
            initialValues={initialFormValues}
        >
            {errorMessage?.map((msg, idx) => (
                <Alert
                    key={idx}
                    message={msg}
                    type="error"
                    showIcon
                    closable
                    onClose={() =>
                        setErrorMessage((prev) => prev?.filter((_, i) => i !== idx) || [])
                    }
                />
            ))}

            <div className="w-full flex flex-col gap-2">
                <Typography.Text className="font-medium">Evaluator name</Typography.Text>
                <Form.Item
                    name="evaluatorName"
                    rules={[{required: true, message: "Evaluator name is required!"}]}
                    className="mb-0"
                >
                    {/* TEMPORARY: Disabling name editing */}
                    <Input placeholder="Enter a name" disabled={isEditMode} />
                </Form.Item>
            </div>

            <div className="w-full flex flex-col gap-2">
                <Typography.Text className="font-medium">Evaluator slug</Typography.Text>
                <Form.Item
                    name="evaluatorSlug"
                    rules={[
                        {
                            required: true,
                            message: "Evaluator slug is required!",
                        },
                        {
                            validator(_, value) {
                                if (!value) {
                                    return Promise.resolve()
                                } else if (!isAppNameInputValid(value)) {
                                    return Promise.reject(
                                        "Slug must contain only letters, numbers, underscore, or dash without any spaces.",
                                    )
                                } else {
                                    return Promise.resolve()
                                }
                            },
                        },
                    ]}
                    className="mb-0"
                >
                    <Input
                        placeholder="Enter a unique slug"
                        disabled={isEditMode}
                        onChange={() => !slugTouched && setSlugTouched(true)}
                    />
                </Form.Item>
            </div>

            <div className="w-full flex flex-col gap-2">
                <Typography.Text className="font-medium">
                    Evaluator description <span className="text-gray-500">(optional)</span>
                </Typography.Text>
                <Form.Item name="evaluatorDescription" rules={[{required: false}]} className="mb-0">
                    <Input.TextArea placeholder="Enter a description" rows={2} />
                </Form.Item>
            </div>

            <Form.List name="metrics">
                {(fields, {add, remove}) => (
                    <div className="flex flex-col gap-4 pb-12">
                        {fields.map((field) => (
                            <CreateNewMetric
                                key={field.key}
                                field={field}
                                onRemove={remove}
                                isFirstMetric={fields.length === 1}
                            />
                        ))}

                        <div className="w-full bg-white h-[50px] border-0 border-t border-solid border-gray-100 flex items-center gap-2 absolute bottom-0 left-0 right-0 pl-4">
                            <Button
                                icon={<Plus size={14} />}
                                className="w-fit"
                                onClick={() => {
                                    add()
                                    onScrollTo("bottom")
                                }}
                            >
                                Add Feedback
                            </Button>
                            <Button
                                type="primary"
                                className="w-fit"
                                onClick={(e) => {
                                    e.preventDefault()
                                    form.submit()
                                }}
                                loading={isSubmitting}
                            >
                                {submitLabel}
                            </Button>
                        </div>
                    </div>
                )}
            </Form.List>
        </Form>
    )
}

export default CreateEvaluator

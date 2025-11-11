import {useCallback, useState, useEffect} from "react"

import {Plus} from "@phosphor-icons/react"
import {Alert, Button, Form, Input, message, Typography} from "antd"
import {useDebounceValue} from "usehooks-ts"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"
import useEvaluators from "@/oss/lib/hooks/useEvaluators"
import {createEvaluator} from "@/oss/services/evaluators"

import {AnnotateDrawerSteps} from "../enum"
import {generateNewEvaluatorPayloadData} from "../transforms"
import {CreateEvaluatorProps} from "../types"

import CreateNewMetric from "./assets/CreateNewMetric"
import {slugify} from "./assets/helper"
import {MetricFormData} from "./assets/types"

const CreateEvaluator = ({setSteps, setSelectedEvaluators}: CreateEvaluatorProps) => {
    const [isSubmitting, setIsSubmitting] = useState(false)
    const [errorMessage, setErrorMessage] = useState<string[]>([])
    const [slugTouched, setSlugTouched] = useState(false)

    const [form] = Form.useForm()
    const name = Form.useWatch("evaluatorName", form)
    const [debouncedName] = useDebounceValue(name, 500)
    const {mutate} = useEvaluators({
        preview: true,
    })

    useEffect(() => {
        if (!slugTouched) {
            form.setFieldValue("evaluatorSlug", slugify(debouncedName || ""))
        }
    }, [debouncedName, slugTouched, form])

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

                await createEvaluator(payloadData)
                await mutate()

                message.success("Evaluator created successfully")
                setSteps?.(AnnotateDrawerSteps.SELECT_EVALUATORS)
                setSelectedEvaluators?.((prev) => [
                    ...new Set([...prev, payloadData.evaluator.slug]),
                ])
            } catch (error: any) {
                if (error.status === 409) {
                    setErrorMessage(["Evaluator with this slug already exists"])
                    message.error("Evaluator with this slug already exists")
                    onScrollTo("top")
                } else {
                    const errorMessages = Array.isArray(error.response?.data?.detail)
                        ? error.response?.data?.detail?.map((item: any) => item?.msg).filter(Boolean)
                        : [error.response?.data?.detail]

                    onScrollTo("top")
                    setErrorMessage(errorMessages)
                }
            } finally {
                setIsSubmitting(false)
            }
        },
        [mutate, setErrorMessage, onScrollTo, setSteps],
    )

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
            initialValues={{
                evaluatorName: "",
                evaluatorSlug: "",
                evaluatorDescription: "",
                metrics: [{name: "", optional: false}],
            }}
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
                    <Input placeholder="Enter a name" />
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
                                Save
                            </Button>
                        </div>
                    </div>
                )}
            </Form.List>
        </Form>
    )
}

export default CreateEvaluator

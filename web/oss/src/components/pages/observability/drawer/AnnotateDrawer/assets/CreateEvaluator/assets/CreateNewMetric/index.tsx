import {useCallback, useEffect, useMemo} from "react"

import {Plus, Trash} from "@phosphor-icons/react"
import {Button, Form, FormListFieldData, Input, InputNumber, Select, Switch, Typography} from "antd"
import dynamic from "next/dynamic"

import {isAppNameInputValid} from "@/oss/lib/helpers/utils"

import {EVALUATOR_OPTIONS, NUMERIC_METRIC_TYPES} from "../../../constants"

const ModelNameInput = dynamic(
    () =>
        import("@/oss/components/ModelRegistry/Drawers/ConfigureProviderDrawer/assets/ModelNameInput"),
    {ssr: false},
)

const {Text} = Typography

const CreateNewMetric = ({
    field,
    onRemove,
    isFirstMetric,
}: {
    field: any
    onRemove: (name: number) => void
    isFirstMetric: boolean
}) => {
    const form = Form.useFormInstance()
    const metricType = Form.useWatch(["metrics", field.name, "type"], form)
    const metricMinimum = Form.useWatch(["metrics", field.name, "minimum"], form)
    const metricEnums = Form.useWatch(["metrics", field.name, "enum"], form) || []
    const allMetrics = Form.useWatch("metrics", form) || []

    // it will add a empty field for enum when user select label option
    useEffect(() => {
        if (metricType !== "label" && metricType !== "class") return

        const existingEnum = form.getFieldValue(["metrics", field.name, "enum"])
        if (!Array.isArray(existingEnum) || existingEnum.length === 0) {
            form.setFieldValue(["metrics", field.name, "enum"], [""])
        }
    }, [metricType, field.name, form])

    const getCurrentEnumValues = useCallback(
        (currentIndex: number) => {
            if (!Array.isArray(metricEnums)) return []
            return metricEnums
                .filter((_, index) => {
                    if (index === currentIndex) return false
                    const fieldValue = form.getFieldValue(["metrics", field.name, "enum", index])
                    return fieldValue !== undefined && fieldValue !== ""
                })
                .filter(Boolean)
        },
        [metricEnums],
    )

    const autoFocusInput = useCallback(
        (fields: FormListFieldData[]) => {
            setTimeout(() => {
                if (fields.length > 0) {
                    const newFieldIndex = fields.length
                    const metricIndex = field.name

                    const inputId = `metrics_${metricIndex}_enum_${newFieldIndex}` // this is a antd input field id naming convention
                    const input = document.getElementById(inputId) as HTMLInputElement
                    if (input) {
                        input.focus()
                    }
                }
            }, 100)
        },
        [field.name],
    )

    const moveBetweenEnumFields = useCallback(
        (e: any) => {
            const key = e.key
            const currentInput = e.currentTarget as HTMLInputElement
            const currentId = currentInput.id

            // Parse the current field indices from the ID (format: metrics_X_enum_Y)
            const match = currentId.match(/metrics_(\d+)_enum_(\d+)/)
            if (!match) return

            const [_, metricIndex, enumIndex] = match
            const currentEnumIndex = parseInt(enumIndex, 10)

            if (key === "ArrowUp" && currentEnumIndex > 0) {
                // Move to previous enum field
                const prevEnumId = `metrics_${metricIndex}_enum_${currentEnumIndex - 1}`
                const prevInput = document.getElementById(prevEnumId) as HTMLInputElement
                prevInput?.focus()
            } else if (key === "ArrowDown") {
                // Move to next enum field
                const nextEnumId = `metrics_${metricIndex}_enum_${currentEnumIndex + 1}`
                const nextInput = document.getElementById(nextEnumId) as HTMLInputElement
                nextInput?.focus()
            }
        },
        [], // No dependencies needed as we're only using the event
    )

    // Get all metric names except the current one being edited
    const allMetricNames = useMemo(
        () =>
            allMetrics
                .filter((_: any, index: number) => index !== field.name)
                .map((metric: any) => metric?.name)
                .filter(Boolean),
        [allMetrics],
    )

    return (
        <div className="flex flex-col gap-4 p-2 bg-[#F5F7FA] rounded-lg">
            <div className="w-full flex flex-col gap-1">
                <div className="w-full flex items-center justify-between">
                    <Text className="font-medium">Feedback name</Text>
                    <Button
                        icon={<Trash size={14} />}
                        type="text"
                        onClick={() => onRemove(field.name)}
                        disabled={isFirstMetric}
                    />
                </div>
                <Form.Item
                    name={[field.name, "name"]}
                    rules={[
                        {required: true, message: "Add feedback name!"},
                        {
                            validator(_, value) {
                                if (!value) {
                                    return Promise.resolve()
                                } else if (!isAppNameInputValid(value)) {
                                    return Promise.reject(
                                        "Slug must contain only letters, numbers, underscore, or dash without any spaces.",
                                    )
                                } else if (allMetricNames.includes(value)) {
                                    return Promise.reject("This feedback name is already in use")
                                }
                                return Promise.resolve()
                            },
                        },
                    ]}
                    className="mb-0"
                >
                    <Input placeholder="Enter a feedback name" />
                </Form.Item>
            </div>
            <div className="w-full flex flex-col gap-1">
                <Text className="font-medium">Feedback type</Text>
                <Form.Item
                    name={[field.name, "type"]}
                    rules={[{required: true, message: "Add feedback type!"}]}
                    className="mb-0"
                >
                    <Select
                        className="w-full !rounded-lg"
                        classNames={{
                            popup: {
                                root: "!capitalize",
                            },
                        }}
                        placeholder="Select type"
                        options={EVALUATOR_OPTIONS}
                    />
                </Form.Item>
            </div>

            {metricType && NUMERIC_METRIC_TYPES.includes(metricType) && (
                <>
                    <div className="w-full flex flex-col gap-1">
                        <Text className="font-medium">Minimum</Text>
                        <Form.Item
                            name={[field.name, "minimum"]}
                            rules={[
                                {
                                    type: "number",
                                    message: "Please enter a valid number",
                                },
                                {
                                    validator(_, value) {
                                        if (
                                            value &&
                                            metricType == "integer" &&
                                            String(value).includes(".")
                                        ) {
                                            return Promise.reject(
                                                "Float values are not allowed for integer metrics",
                                            )
                                        }
                                        return Promise.resolve()
                                    },
                                },
                            ]}
                            className="mb-0"
                        >
                            <InputNumber
                                type="number"
                                className="w-full"
                                placeholder="Value"
                                step={metricType === "integer" ? 1 : 0.1}
                                formatter={(value) => {
                                    if (!value && value !== 0) return ""
                                    const strValue = String(value)
                                    if (metricType === "integer" && strValue.includes(".")) {
                                        return strValue.split(".")[0]
                                    }
                                    return strValue
                                }}
                            />
                        </Form.Item>
                    </div>
                    <div className="w-full flex flex-col gap-1">
                        <Text className="font-medium">Maximum</Text>
                        <Form.Item
                            name={[field.name, "maximum"]}
                            rules={[
                                {
                                    type: "number",
                                    message: "Please enter a valid number",
                                },
                                {
                                    validator(_, value) {
                                        if (value && Number(value) <= metricMinimum) {
                                            return Promise.reject(
                                                "Maximum value must be greater than minimum value",
                                            )
                                        } else if (
                                            value &&
                                            metricType == "integer" &&
                                            String(value).includes(".")
                                        ) {
                                            return Promise.reject(
                                                "Float values are not allowed for integer metrics",
                                            )
                                        }
                                        return Promise.resolve()
                                    },
                                },
                            ]}
                            className="mb-0"
                        >
                            <InputNumber
                                type="number"
                                className="w-full"
                                placeholder="Value"
                                step={metricType === "integer" ? 1 : 0.1}
                                formatter={(value) => {
                                    if (!value && value !== 0) return ""
                                    const strValue = String(value)
                                    if (metricType === "integer" && strValue.includes(".")) {
                                        return strValue.split(".")[0]
                                    }
                                    return strValue
                                }}
                            />
                        </Form.Item>
                    </div>
                </>
            )}

            {metricType === "label" || metricType === "class" ? (
                <Form.List name={[field.name, "enum"]}>
                    {(fields, {add, remove}) => (
                        <div className="flex flex-col gap-2">
                            <div className="w-full flex items-center justify-between">
                                <Text className="font-medium">Options</Text>
                                <Button
                                    icon={<Plus size={14} />}
                                    size="small"
                                    onClick={() => add()}
                                >
                                    Add
                                </Button>
                            </div>
                            {fields.length === 0 ? (
                                <Text className="text-[#586673]">No options configured</Text>
                            ) : (
                                fields.map((fieldItem, index) => (
                                    <div key={fieldItem.key} className="flex items-center gap-2">
                                        <Form.Item
                                            {...fieldItem}
                                            rules={[
                                                {
                                                    required: index === 0,
                                                    message: "At least one option is required",
                                                },
                                                {
                                                    validator(_, value) {
                                                        if (!value) return Promise.resolve()

                                                        const enums = getCurrentEnumValues(index)
                                                        const isDuplicate = enums.some(
                                                            (v) => v === value,
                                                        )

                                                        if (isDuplicate) {
                                                            return Promise.reject(
                                                                "This option is already added",
                                                            )
                                                        }

                                                        return Promise.resolve()
                                                    },
                                                },
                                            ]}
                                            className="flex-1 mb-0"
                                        >
                                            <ModelNameInput
                                                onDelete={() => remove(fieldItem.name)}
                                                placeholder="Enter option name"
                                                disabled={fields.length === 1}
                                                onKeyDown={(e) => {
                                                    const key = e.key
                                                    if (key === "Enter") {
                                                        e.preventDefault()
                                                        add()
                                                        autoFocusInput(fields)
                                                    }

                                                    if (key === "ArrowUp" || key === "ArrowDown") {
                                                        e.preventDefault()
                                                        moveBetweenEnumFields(e)
                                                    }
                                                }}
                                            />
                                        </Form.Item>
                                    </div>
                                ))
                            )}
                        </div>
                    )}
                </Form.List>
            ) : null}

            <div className="w-full flex justify-between items-center gap-1">
                <Text className="font-medium">Optional</Text>
                <Form.Item name={[field.name, "optional"]} className="mb-0">
                    <Switch />
                </Form.Item>
            </div>
        </div>
    )
}

export default CreateNewMetric

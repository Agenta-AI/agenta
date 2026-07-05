import {forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState} from "react"

import {
    Accordion,
    AccordionContent,
    AccordionItem,
    AccordionTrigger,
} from "@agenta/primitive-ui/components/accordion"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    Select,
    SelectContent,
    SelectItem,
    SelectTrigger,
    SelectValue,
} from "@agenta/primitive-ui/components/select"
import {buildFormFieldsFromSchema, type FormFieldDescriptor} from "@agenta/shared/utils"
import {Editor} from "@agenta/ui/editor"
import {MinusCircle, Plus} from "@phosphor-icons/react"
import {Form, Input, InputNumber, Switch} from "antd"
import type {FormInstance} from "antd"

export interface SchemaFormHandle {
    getValues: () => Promise<Record<string, unknown>>
}

interface Props {
    schema: Record<string, unknown> | null | undefined
    form: FormInstance
    disabled?: boolean
    jsonMode?: boolean
    /** Render optional fields inline instead of behind an "Optional (N)" collapse. */
    flat?: boolean
}

const SchemaForm = forwardRef<SchemaFormHandle, Props>(
    ({schema, form, disabled, jsonMode, flat}, ref) => {
        const fields = useMemo(() => buildFormFieldsFromSchema(schema), [schema])
        const requiredFields = useMemo(() => fields.filter((f) => f.required), [fields])
        const optionalFields = useMemo(() => fields.filter((f) => !f.required), [fields])

        // JSON editor state
        const jsonRef = useRef("")
        const [jsonError, setJsonError] = useState<string | null>(null)

        // Sync form → JSON when entering JSON mode
        const lastFormSnapshot = useRef<string>("{}")
        const syncFormToJson = useCallback(() => {
            try {
                const values = form.getFieldsValue(true)
                const cleaned = cleanFormValues(values)
                const json = JSON.stringify(cleaned, null, 2)
                lastFormSnapshot.current = json
                jsonRef.current = json
                setJsonError(null)
            } catch {
                lastFormSnapshot.current = "{}"
                jsonRef.current = "{}"
            }
        }, [form])

        // When jsonMode turns on, snapshot form values
        const prevJsonMode = useRef(jsonMode)
        if (jsonMode && !prevJsonMode.current) {
            syncFormToJson()
        }
        prevJsonMode.current = jsonMode

        const handleJsonChange = useCallback(({textContent}: {textContent: string}) => {
            jsonRef.current = textContent
            try {
                JSON.parse(textContent)
                setJsonError(null)
            } catch (e) {
                setJsonError(e instanceof Error ? e.message : "Invalid JSON")
            }
        }, [])

        useImperativeHandle(
            ref,
            () => ({
                getValues: async () => {
                    if (jsonMode) {
                        const text = jsonRef.current
                        const parsed = JSON.parse(text)
                        if (typeof parsed !== "object" || parsed === null) {
                            throw new Error("Input must be a JSON object")
                        }
                        return parsed as Record<string, unknown>
                    } else {
                        const values = await form.validateFields()
                        return cleanFormValues(values)
                    }
                },
            }),
            [jsonMode, form],
        )

        if (fields.length === 0 && !jsonMode) {
            return (
                <span className="text-xs text-muted-foreground">No input parameters required.</span>
            )
        }

        if (jsonMode) {
            return (
                <div className="flex flex-col gap-1">
                    <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
                        <Editor
                            initialValue={lastFormSnapshot.current}
                            onChange={handleJsonChange}
                            codeOnly
                            showToolbar={false}
                            language="json"
                            validationSchema={schema ?? undefined}
                            dimensions={{width: "100%", height: 280}}
                            disabled={disabled}
                        />
                    </div>
                    {jsonError && <span className="text-xs text-destructive">{jsonError}</span>}
                </div>
            )
        }

        return (
            <Form
                form={form}
                layout="vertical"
                disabled={disabled}
                requiredMark={false}
                className={
                    flat
                        ? "[&_.ant-form-item]:!mb-3 [&_.ant-form-item-label]:!pb-1 [&_.ant-form-item-label>label]:!h-auto [&_.ant-form-item-label>label]:!text-xs"
                        : "[&_.ant-form-item]:!mb-3"
                }
            >
                {requiredFields.map((field) => (
                    <SchemaFormField key={field.name} field={field} />
                ))}

                {flat
                    ? optionalFields.map((field) => (
                          <SchemaFormField key={field.name} field={field} />
                      ))
                    : optionalFields.length > 0 && (
                          <Accordion className="!-mx-4 !mt-1 bg-transparent [&_[data-slot=accordion-item]]:border-none [&_[data-slot=accordion-trigger]]:border-none [&_[data-slot=accordion-trigger]]:!py-1 [&_[data-slot=accordion-content]>div]:!pt-1 [&_[data-slot=accordion-content]>div]:!pb-1">
                              <AccordionItem value="optional">
                                  <AccordionTrigger>
                                      <span className="text-xs text-muted-foreground">
                                          Optional ({optionalFields.length})
                                      </span>
                                  </AccordionTrigger>
                                  <AccordionContent>
                                      {optionalFields.map((field) => (
                                          <SchemaFormField key={field.name} field={field} />
                                      ))}
                                  </AccordionContent>
                              </AccordionItem>
                          </Accordion>
                      )}
            </Form>
        )
    },
)

SchemaForm.displayName = "SchemaForm"
export default SchemaForm

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Wraps shadcn Select to accept antd Form.Item's injected value/onChange */
function AntdFormSelect({
    value,
    onChange,
    placeholder,
    allowClear,
    options = [],
}: {
    value?: string
    onChange?: (v: string) => void
    placeholder?: string
    allowClear?: boolean
    options: {value: string; label: string}[]
}) {
    return (
        <Select value={value} onValueChange={onChange}>
            <SelectTrigger className="w-full">
                <SelectValue placeholder={placeholder} />
            </SelectTrigger>
            <SelectContent>
                {options.map((o) => (
                    <SelectItem key={o.value} value={o.value}>
                        {o.label}
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}

/** Recursively parse stringified JSON in nested form values */
function cleanFormValues(values: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(values)) {
        if (value === undefined || value === null || value === "") continue
        if (typeof value === "string") {
            try {
                result[key] = JSON.parse(value)
            } catch {
                result[key] = value
            }
        } else if (Array.isArray(value)) {
            result[key] = value.map((item) => {
                if (typeof item === "object" && item !== null && !Array.isArray(item)) {
                    return cleanFormValues(item as Record<string, unknown>)
                }
                if (typeof item === "string") {
                    try {
                        return JSON.parse(item)
                    } catch {
                        return item
                    }
                }
                return item
            })
        } else if (typeof value === "object") {
            result[key] = cleanFormValues(value as Record<string, unknown>)
        } else {
            result[key] = value
        }
    }
    return result
}

// ---------------------------------------------------------------------------
// Field components
// ---------------------------------------------------------------------------

function FieldLabel({field}: {field: FormFieldDescriptor}) {
    return (
        <div className="flex flex-col leading-tight">
            <span>
                {field.label}
                {field.required && <span className="text-red-500 ml-1">*</span>}
            </span>
            {field.description && (
                <span className="!text-[11px] font-normal leading-snug text-muted-foreground">
                    {field.description}
                </span>
            )}
        </div>
    )
}

function SchemaFormField({field, depth = 0}: {field: FormFieldDescriptor; depth?: number}) {
    const rules = field.required ? [{required: true, message: `${field.label} is required`}] : []
    const label = <FieldLabel field={field} />

    // Object with nested children → render in a collapsible section
    if (field.type === "object" && field.children && field.children.length > 0) {
        return (
            <Accordion
                defaultValue={field.required ? ["obj"] : undefined}
                className={`${depth > 0 ? "!-mx-2 border-l border-gray-200 ml-2" : "!-mx-4 !mb-2"} bg-transparent [&_[data-slot=accordion-item]]:border-none [&_[data-slot=accordion-trigger]]:border-none [&_[data-slot=accordion-trigger]]:!py-1 [&_[data-slot=accordion-content]>div]:!pt-1 [&_[data-slot=accordion-content]>div]:!pb-1`}
            >
                <AccordionItem value="obj">
                    <AccordionTrigger>
                        <div className="flex flex-col leading-tight">
                            <span className="font-medium">
                                {field.label}
                                {field.required && <span className="text-red-500 ml-1">*</span>}
                            </span>
                            {field.description && (
                                <span className="!text-xs leading-snug text-muted-foreground">
                                    {field.description}
                                </span>
                            )}
                        </div>
                    </AccordionTrigger>
                    <AccordionContent keepMounted>
                        {field.children.map((child) => (
                            <SchemaFormField key={child.name} field={child} depth={depth + 1} />
                        ))}
                    </AccordionContent>
                </AccordionItem>
            </Accordion>
        )
    }

    // Free-form object or array → JSON editor
    if ((field.type === "object" || field.type === "array") && field.freeform) {
        return (
            <Form.Item
                name={field.name.split(".")}
                label={label}
                rules={[
                    ...rules,
                    {
                        validator: async (_, value) => {
                            if (!value) return
                            try {
                                JSON.parse(value)
                            } catch {
                                throw new Error("Must be valid JSON")
                            }
                        },
                    },
                ]}
            >
                <JsonFieldEditor
                    placeholder={field.type === "object" ? '{"key": "value"}' : '[{"item": 1}]'}
                />
            </Form.Item>
        )
    }

    // Array with structured item schema → Form.List with add/remove
    if (field.type === "array") {
        return <ArrayField field={field} rules={rules} depth={depth} />
    }

    switch (field.type) {
        case "boolean":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    valuePropName="checked"
                    initialValue={field.default ?? false}
                >
                    <Switch size="small" />
                </Form.Item>
            )

        case "number":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={rules}
                    initialValue={field.default}
                >
                    <InputNumber className="w-full" placeholder={field.label} />
                </Form.Item>
            )

        case "enum":
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={rules}
                    initialValue={field.default}
                >
                    <AntdFormSelect
                        placeholder={field.label}
                        options={(field.enumValues ?? []).map((v) => ({value: v, label: v}))}
                    />
                </Form.Item>
            )

        default:
            return (
                <Form.Item
                    name={field.name.split(".")}
                    label={label}
                    rules={rules}
                    initialValue={field.default}
                >
                    <Input placeholder={field.label} />
                </Form.Item>
            )
    }
}

// ---------------------------------------------------------------------------
// Array field with Form.List (add / remove)
// ---------------------------------------------------------------------------

function ArrayField({
    field,
    rules,
    depth,
}: {
    field: FormFieldDescriptor
    rules: {required: boolean; message: string}[]
    depth: number
}) {
    const namePath = field.name.split(".")
    const hasObjectItems = !!field.itemChildren && field.itemChildren.length > 0
    const primitiveItemType = field.itemSchema?.type as string | undefined

    return (
        <div className={depth > 0 ? "ml-2 border-l border-gray-200 pl-3 mb-3" : "mb-3"}>
            <div className="flex items-center justify-between mb-2">
                <div className="flex flex-col leading-tight">
                    <span className="font-medium">
                        {field.label}
                        {field.required && <span className="text-red-500 ml-1">*</span>}
                    </span>
                    {field.description && (
                        <span className="!text-[11px] font-normal leading-snug text-muted-foreground">
                            {field.description}
                        </span>
                    )}
                </div>
            </div>

            <Form.List
                name={namePath}
                rules={
                    rules.length > 0
                        ? [
                              {
                                  validator: async (_, value) => {
                                      if (field.required && (!value || value.length === 0)) {
                                          throw new Error(`At least one ${field.label} is required`)
                                      }
                                  },
                              },
                          ]
                        : undefined
                }
            >
                {(fields, {add, remove}) => (
                    <div className="flex flex-col gap-2">
                        {fields.length === 0 && (
                            <span className="text-xs text-muted-foreground">No items added</span>
                        )}

                        {fields.map(({key, name, ...restField}) =>
                            hasObjectItems ? (
                                <ArrayObjectItem
                                    key={key}
                                    name={name}
                                    restField={restField}
                                    itemChildren={field.itemChildren!}
                                    onRemove={() => remove(name)}
                                    depth={depth}
                                />
                            ) : (
                                <div key={key} className="flex items-start gap-2">
                                    <Form.Item
                                        {...restField}
                                        name={[name]}
                                        className="!mb-0 flex-1"
                                    >
                                        {primitiveItemType === "number" ||
                                        primitiveItemType === "integer" ? (
                                            <InputNumber
                                                className="w-full"
                                                placeholder={`${field.label} item`}
                                            />
                                        ) : (
                                            <Input placeholder={`${field.label} item`} />
                                        )}
                                    </Form.Item>
                                    <Button
                                        aria-label="Remove item"
                                        onClick={() => remove(name)}
                                        className="mt-0.5 opacity-50 hover:opacity-100"
                                        variant="ghost"
                                        size="icon"
                                    >
                                        {<MinusCircle size={16} />}
                                    </Button>
                                </div>
                            ),
                        )}

                        <Button
                            onClick={() => add(hasObjectItems ? {} : undefined)}
                            className="self-start border-dashed"
                            variant="outline"
                            size="sm"
                        >
                            {<Plus size={14} />}
                            Add {field.label}
                        </Button>
                    </div>
                )}
            </Form.List>
        </div>
    )
}

// ---------------------------------------------------------------------------
// Array item that is an object with structured fields
// ---------------------------------------------------------------------------

function ArrayObjectItem({
    name,
    restField,
    itemChildren,
    onRemove,
    depth,
}: {
    name: number
    restField: {fieldKey?: number}
    itemChildren: FormFieldDescriptor[]
    onRemove: () => void
    depth: number
}) {
    return (
        <div className="!-mx-2 border border-solid border-gray-200 rounded-lg p-2">
            <div className="flex items-center justify-between mb-2">
                <span className="text-xs">Item {name + 1}</span>
                <Button
                    aria-label="Remove object item"
                    onClick={onRemove}
                    className="opacity-50 hover:opacity-100"
                    variant="ghost"
                    size="icon-sm"
                >
                    {<MinusCircle size={14} />}
                </Button>
            </div>
            {itemChildren.map((child) => {
                const childRules = child.required
                    ? [{required: true, message: `${child.label} is required`}]
                    : []
                const childLabel = <FieldLabel field={child} />

                if (child.type === "object" && child.children && child.children.length > 0) {
                    return (
                        <div key={child.name} className="!-mx-2 ml-2 border-l border-gray-200">
                            <span className="font-medium">{child.label}</span>
                            {child.children.map((gc) => (
                                <Form.Item
                                    key={gc.name}
                                    {...restField}
                                    name={[name, ...gc.name.split(".")]}
                                    label={<FieldLabel field={gc} />}
                                    rules={
                                        gc.required
                                            ? [
                                                  {
                                                      required: true,
                                                      message: `${gc.label} is required`,
                                                  },
                                              ]
                                            : []
                                    }
                                >
                                    <Input placeholder={gc.label} />
                                </Form.Item>
                            ))}
                        </div>
                    )
                }

                if (child.type === "boolean") {
                    return (
                        <Form.Item
                            key={child.name}
                            {...restField}
                            name={[name, child.name]}
                            label={childLabel}
                            valuePropName="checked"
                            initialValue={child.default ?? false}
                        >
                            <Switch size="small" />
                        </Form.Item>
                    )
                }

                if (child.type === "number") {
                    return (
                        <Form.Item
                            key={child.name}
                            {...restField}
                            name={[name, child.name]}
                            label={childLabel}
                            rules={childRules}
                            initialValue={child.default}
                        >
                            <InputNumber className="w-full" placeholder={child.label} />
                        </Form.Item>
                    )
                }

                if (child.type === "enum") {
                    return (
                        <Form.Item
                            key={child.name}
                            {...restField}
                            name={[name, child.name]}
                            label={childLabel}
                            rules={childRules}
                            initialValue={child.default}
                        >
                            <AntdFormSelect
                                placeholder={child.label}
                                options={(child.enumValues ?? []).map((v) => ({
                                    value: v,
                                    label: v,
                                }))}
                            />
                        </Form.Item>
                    )
                }

                return (
                    <Form.Item
                        key={child.name}
                        {...restField}
                        name={[name, child.name]}
                        label={childLabel}
                        rules={childRules}
                        initialValue={child.default}
                    >
                        <Input placeholder={child.label} />
                    </Form.Item>
                )
            })}
        </div>
    )
}

// ---------------------------------------------------------------------------
// JSON editor for free-form object/array fields
// ---------------------------------------------------------------------------

function JsonFieldEditor({
    value,
    onChange,
    placeholder,
    disabled,
}: {
    value?: string
    onChange?: (value: string) => void
    placeholder?: string
    disabled?: boolean
}) {
    const handleChange = useCallback(
        ({textContent}: {textContent: string}) => {
            onChange?.(textContent)
        },
        [onChange],
    )

    return (
        <div className="rounded-lg border border-solid border-gray-300 dark:border-gray-700 overflow-hidden">
            <Editor
                initialValue={value || placeholder || "{}"}
                onChange={handleChange}
                codeOnly
                showToolbar={false}
                language="json"
                dimensions={{width: "100%", height: 120}}
                disabled={disabled}
            />
        </div>
    )
}

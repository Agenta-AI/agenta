import {useCallback} from "react"

import {InfoCircleOutlined} from "@ant-design/icons"
import {theme, Form, Tooltip, InputNumber, Switch, Input, AutoComplete} from "antd"
import {FormInstance, Rule} from "antd/es/form"
import Link from "next/link"
import {createUseStyles} from "react-jss"

import SharedEditor from "@/oss/components/Playground/Components/SharedEditor"
import {isValidRegex} from "@/oss/lib/helpers/validators"
import {generatePaths} from "@/oss/lib/transformers"
import {EvaluationSettingsTemplate, JSSTheme} from "@/oss/lib/Types"

import {FieldsTagsEditor} from "./FieldsTagsEditor"
import {JSONSchemaEditor} from "./JSONSchema"
import {Messages} from "./Messages"

type DynamicFormFieldProps = EvaluationSettingsTemplate & {
    name: string | string[]
    traceTree: Record<string, any>
    form?: FormInstance<any>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    codeEditor: {
        "& .agenta-editor-wrapper": {
            minHeight: 375,
        },
        "&.agenta-shared-editor": {
            borderColor: theme.colorBorder,
        },
    },
    objectEditor: {
        "& .agenta-editor-wrapper": {
            minHeight: 120,
        },
        "&.agenta-shared-editor": {
            borderColor: theme.colorBorder,
        },
    },
    ExternalHelp: {
        marginBottom: "20px",
        display: "flex",
        alignItems: "center",
        gap: "0.3em",
    },
    ExternalHelpLink: {
        margin: "0px",
        padding: "0px",
        textDecoration: "underline",
        color: theme.isDark ? "rgba(255, 255, 255, 0.85)" : "#000",

        "&:hover": {
            color: theme.isDark ? "rgba(255, 255, 255, 0.85)" : "#000",
            textDecoration: "underline",
        },
    },
}))

interface ControlledSharedEditorProps {
    value?: unknown
    onChange?: (value: string) => void
    className?: string
    language?: "json" | "yaml" | "code" | "python" | "javascript" | "typescript"
}

const ControlledSharedEditor = ({
    value,
    onChange,
    className,
    language,
}: ControlledSharedEditorProps) => {
    const handleValueChange = useCallback(
        (next: string) => {
            onChange?.(next)
        },
        [onChange],
    )

    return (
        <SharedEditor
            initialValue={value}
            value={value as string}
            handleChange={handleValueChange}
            className={className}
            syncWithInitialValueChanges
            editorProps={{
                codeOnly: true,
                ...(language ? {language} : {}),
            }}
        />
    )
}

export const DynamicFormField: React.FC<DynamicFormFieldProps> = ({
    name,
    label,
    type,
    default: defaultVal,
    description,
    min,
    max,
    required,
    traceTree,
    form,
}) => {
    const settingsValue = Form.useWatch(name, form)
    const runtime = Form.useWatch(["parameters", "runtime"], form)

    const classes = useStyles()
    const {token} = theme.useToken()

    const watched = Form.useWatch(name as any, form)
    const savedValue = watched ?? defaultVal
    const handleValueChange = useCallback(
        (next: string) => {
            if (form) {
                form.setFieldsValue({
                    [name as string]: next,
                })
            }
        },
        [form, name],
    )

    const runtimeLanguage =
        runtime === "python" || runtime === "javascript" || runtime === "typescript"
            ? runtime
            : "code"

    const rules: Rule[] = [{required: required ?? true, message: "This field is required"}]

    if (type === "regex")
        rules.push({
            validator: (_, value) =>
                new Promise((res, rej) =>
                    isValidRegex(value) ? res("") : rej("Regex pattern is not valid"),
                ),
        })

    const ExternalHelpInfo =
        name[1] === "webhook_url" ? (
            <div className={classes.ExternalHelp}>
                <span>Learn</span>
                <Link
                    href="https://agenta.ai/docs/evaluation/evaluators/webhook-evaluator"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classes.ExternalHelpLink}
                >
                    more
                </Link>
                <span>about the evaluator</span>
            </div>
        ) : null

    return (
        <>
            {label !== "Correct Answer" && (
                <Form.Item
                    name={name}
                    label={
                        <div className="flex items-center gap-2">
                            <span>{label}</span>
                            {description && (
                                <Tooltip title={description}>
                                    <InfoCircleOutlined style={{color: token.colorPrimary}} />
                                </Tooltip>
                            )}
                        </div>
                    }
                    initialValue={
                        type === "object" && defaultVal && typeof defaultVal === "object"
                            ? JSON.stringify(defaultVal, null, 2)
                            : defaultVal
                    }
                    rules={rules}
                    hidden={type === "hidden"}
                >
                    {name[1] === "question_key" ||
                    name[1] === "answer_key" ||
                    name[1] === "contexts_key" ? (
                        <AutoComplete
                            options={generatePaths(traceTree)}
                            filterOption={(inputValue, option) =>
                                option!.value.toUpperCase().indexOf(inputValue.toUpperCase()) !== -1
                            }
                        />
                    ) : type === "string" || type === "regex" ? (
                        <Input />
                    ) : type === "hidden" ? (
                        <Input type="hidden" />
                    ) : type === "messages" ? (
                        <Messages />
                    ) : type === "number" ? (
                        <InputNumber min={min} max={max} step={0.1} />
                    ) : type === "boolean" || type === "bool" ? (
                        <Switch />
                    ) : type === "text" ? (
                        <Input.TextArea rows={10} />
                    ) : type === "code" ? (
                        <ControlledSharedEditor
                            className={classes.codeEditor}
                            value={settingsValue}
                            onChange={handleValueChange}
                            language={runtimeLanguage}
                        />
                    ) : type === "object" ? (
                        <ControlledSharedEditor
                            className={classes.objectEditor}
                            language="json"
                            value={settingsValue}
                            onChange={handleValueChange}
                        />
                    ) : type === "llm_response_schema" ? (
                        <JSONSchemaEditor
                            form={form!}
                            name={name}
                            defaultValue={
                                typeof savedValue === "string"
                                    ? savedValue
                                    : JSON.stringify(savedValue ?? {}, null, 2)
                            }
                        />
                    ) : type === "fields_tags_editor" ? (
                        <FieldsTagsEditor form={form} name={name} />
                    ) : null}
                </Form.Item>
            )}

            {ExternalHelpInfo}
        </>
    )
}

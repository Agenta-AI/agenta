import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {isValidRegex} from "@/lib/helpers/validators"
import {generatePaths} from "@/lib/transformers"
import {EvaluationSettingsTemplate, JSSTheme} from "@/lib/Types"
import {InfoCircleOutlined} from "@ant-design/icons"
import {Editor} from "@monaco-editor/react"
import {theme, Form, Tooltip, InputNumber, Switch, Input, AutoComplete} from "antd"
import {Rule} from "antd/es/form"
import {Messages} from "./Messages"
import Link from "next/link"
import {createUseStyles} from "react-jss"

type DynamicFormFieldProps = EvaluationSettingsTemplate & {
    name: string | string[]
    traceTree: Record<string, any>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
        "& .monaco-editor": {
            width: "0 !important",
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
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const {token} = theme.useToken()

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
                    href="https://docs.agenta.ai/evaluation/webhook_evaluator"
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
                    initialValue={defaultVal}
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
                        <Editor
                            className={classes.editor}
                            height={375}
                            width="100%"
                            language="python"
                            theme={`vs-${appTheme}`}
                        />
                    ) : type === "object" ? (
                        <Editor
                            className={classes.editor}
                            height={120}
                            width="100%"
                            language="json"
                            options={{lineNumbers: "off"}}
                            theme={`vs-${appTheme}`}
                        />
                    ) : null}
                </Form.Item>
            )}

            {ExternalHelpInfo}
        </>
    )
}

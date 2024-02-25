import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {EvaluationSettingsTemplate, Evaluator, EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {evaluatorsAtom} from "@/lib/atoms/evaluation"
import {isValidRegex} from "@/lib/helpers/validators"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    updateEvaluatorConfig,
} from "@/services/evaluations"
import {EditOutlined, InfoCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Editor} from "@monaco-editor/react"
import {Divider, Form, Input, InputNumber, Modal, Radio, Switch, Tooltip, theme} from "antd"
import {Rule} from "antd/es/form"
import {useAtom} from "jotai"
import Image from "next/image"
import Link from "next/link"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    label: {
        display: "flex",
        alignItems: "center",
        gap: "0.5rem",
    },
    evaluationImg: {
        width: 20,
        height: 20,
        marginRight: "8px",
        filter: theme.isDark ? "invert(1)" : "none",
    },
    radioGroup: {
        "& .ant-radio-button-wrapper": {
            margin: "0.25rem",
            borderRadius: theme.borderRadius,
            borderLeft: `1px solid ${theme.colorBorder}`,
            "&::before": {
                display: "none",
            },
        },
        "& .ant-radio-button-wrapper-checked ": {
            borderLeft: `1px solid ${theme.colorPrimary}`,
        },
    },
    radioBtn: {
        display: "flex",
        alignItems: "center",
        gap: "0.325rem",
    },
    divider: {
        margin: "1rem -1.5rem",
        width: "unset",
    },
    editor: {
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        overflow: "hidden",
    },
    ExternalHelp: {
        marginTop: "10px",
        display: "flex",
        alignItems: "center",
        gap: "0.3em",
    },
    ExternalHelpLink: {
        margin: "0px",
        padding: "0px",
        textDecoration: "underline",
        color: "rgba(255, 255, 255, 0.85)",

        "&:hover": {
            color: "rgba(255, 255, 255, 0.85)",
            textDecoration: "underline",
        },
    },
}))

type DynamicFormFieldProps = EvaluationSettingsTemplate & {
    name: string | string[]
}

const DynamicFormField: React.FC<DynamicFormFieldProps> = ({
    name,
    label,
    type,
    default: defaultVal,
    description,
}) => {
    const {appTheme} = useAppTheme()
    const classes = useStyles()
    const {token} = theme.useToken()

    const rules: Rule[] = [{required: true, message: "This field is required"}]
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
                    href="https://docs.agenta.ai/basic_guides/automatic_evaluation#configuring-evaluators"
                    target="_blank"
                    rel="noopener noreferrer"
                    className={classes.ExternalHelpLink}
                >
                    More
                </Link>
                <span>About The Evaluator</span>
            </div>
        ) : null

    return (
        <Form.Item
            name={name}
            label={
                <div className={classes.label}>
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
        >
            {type === "string" || type === "regex" ? (
                <Input />
            ) : type === "number" ? (
                <InputNumber min={0} max={1} step={0.1} />
            ) : type === "boolean" || type === "bool" ? (
                <Switch />
            ) : type === "text" ? (
                <Input.TextArea autoSize={{minRows: 3, maxRows: 8}} />
            ) : type === "code" ? (
                <Editor
                    className={classes.editor}
                    height={400}
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
            {ExternalHelpInfo}
        </Form.Item>
    )
}

type Props = {
    onSuccess?: () => void
    initialValues?: EvaluatorConfig
    editMode?: boolean
} & React.ComponentProps<typeof Modal>

const NewEvaluatorModal: React.FC<Props> = ({
    onSuccess,
    editMode = false,
    initialValues,
    ...props
}) => {
    const classes = useStyles()
    const evaluators = useAtom(evaluatorsAtom)[0].filter((item) => !item.direct_use)
    const [selectedEval, setSelectedEval] = useState<Evaluator | null>(null)
    const [submitLoading, setSubmitLoading] = useState(false)
    const appId = useAppId()
    const [form] = Form.useForm()

    const evalFields = useMemo(
        () =>
            Object.keys(selectedEval?.settings_template || {})
                .filter((key) => !!selectedEval?.settings_template[key]?.type)
                .map((key) => ({
                    key,
                    ...selectedEval?.settings_template[key]!,
                })),
        [selectedEval],
    )

    useEffect(() => {
        form.resetFields()
        if (initialValues) form.setFieldsValue(initialValues)
        setSelectedEval(
            evaluators.find((item) => item.key === initialValues?.evaluator_key) || null,
        )
    }, [props.open])

    const onSubmit = (values: CreateEvaluationConfigData) => {
        setSubmitLoading(true)
        const data = {...values, settings_values: values.settings_values || {}}
        ;(editMode
            ? updateEvaluatorConfig(initialValues?.id!, data)
            : createEvaluatorConfig(appId, data)
        )
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    return (
        <Modal
            title="New Evaluator"
            onOk={form.submit}
            okText={editMode ? "Update" : "Create"}
            okButtonProps={{
                icon: editMode ? <EditOutlined /> : <PlusOutlined />,
                loading: submitLoading,
            }}
            width={650}
            {...props}
        >
            <Divider className={classes.divider} />
            <Form
                requiredMark={false}
                form={form}
                name="new-evaluator"
                onFinish={onSubmit}
                layout="vertical"
            >
                <Form.Item
                    name="name"
                    label="Name"
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Input data-cy="new-evaluator-modal-input" />
                </Form.Item>
                <Form.Item
                    name="evaluator_key"
                    label="Template"
                    rules={[{required: true, message: "This field is required"}]}
                >
                    <Radio.Group
                        disabled={editMode}
                        onChange={(e) =>
                            setSelectedEval(
                                evaluators.find((item) => item.key === e.target.value) || null,
                            )
                        }
                        className={classes.radioGroup}
                    >
                        {evaluators.map((evaluator, index) => (
                            <Radio.Button key={evaluator.key} value={evaluator.key}>
                                <div
                                    className={classes.radioBtn}
                                    data-cy={`new-evaluator-modal-button-${index}`}
                                >
                                    {evaluator.icon_url && (
                                        <Image
                                            src={evaluator.icon_url}
                                            alt="Exact match"
                                            className={classes.evaluationImg}
                                        />
                                    )}
                                    <span>{evaluator.name}</span>
                                </div>
                            </Radio.Button>
                        ))}
                    </Radio.Group>
                </Form.Item>
                {evalFields.map((field) => (
                    <DynamicFormField
                        {...field}
                        key={field.key}
                        name={["settings_values", field.key]}
                    />
                ))}
            </Form>
        </Modal>
    )
}

export default NewEvaluatorModal

import {useAppTheme} from "@/components/Layout/ThemeContextProvider"
import {useAppId} from "@/hooks/useAppId"
import {EvaluationSettingsTemplate, Evaluator, JSSTheme} from "@/lib/Types"
import {isValidRegex} from "@/lib/helpers/validators"
import {
    CreateEvaluationConfigData,
    createEvaluatorConfig,
    fetchAllEvaluators,
} from "@/services/evaluations"
import {InfoCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Editor} from "@monaco-editor/react"
import {Form, Input, InputNumber, Modal, Radio, Spin, Switch, Tooltip, theme} from "antd"
import {Rule} from "antd/es/form"
import Image from "next/image"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    spinContainer: {
        display: "grid",
        placeItems: "center",
        height: "100%",
    },
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
    radioBtn: {
        display: "flex",
        alignItems: "center",
        gap: "0.325rem",
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
                <InputNumber />
            ) : type === "boolean" ? (
                <Switch />
            ) : type === "text" ? (
                <Input.TextArea autoSize={{minRows: 3, maxRows: 8}} />
            ) : type === "code" ? (
                <Editor height="400px" width="100%" language="python" theme={`vs-${appTheme}`} />
            ) : null}
        </Form.Item>
    )
}

type Props = {
    onSuccess?: () => void
} & React.ComponentProps<typeof Modal>

const NewEvaluatorModal: React.FC<Props> = ({onSuccess, ...props}) => {
    const classes = useStyles()
    const [fetching, setFetching] = useState(false)
    const [evaluators, setEvaluators] = useState<Evaluator[]>([])
    const [selectedEval, setSelectedEval] = useState<Evaluator | null>(null)
    const [submitLoading, setSubmitLoading] = useState(false)
    const appId = useAppId()
    const [form] = Form.useForm()

    const evalFields = useMemo(
        () =>
            Object.keys(selectedEval?.settings_template || {}).map((key) => ({
                key,
                ...selectedEval?.settings_template[key]!,
            })),
        [selectedEval],
    )

    useEffect(() => {
        setFetching(true)
        setSelectedEval(null)
        form.resetFields()
        fetchAllEvaluators()
            .then(setEvaluators)
            .catch(console.error)
            .finally(() => setFetching(false))
    }, [props.open])

    const onSubmit = (values: CreateEvaluationConfigData) => {
        setSubmitLoading(true)
        createEvaluatorConfig(appId, values)
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    return (
        <Modal
            title="New Evaluation"
            onOk={form.submit}
            okText="Create"
            okButtonProps={{icon: <PlusOutlined />, loading: submitLoading}}
            {...props}
        >
            <Spin spinning={fetching}>
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
                        <Input />
                    </Form.Item>
                    <Form.Item
                        name="evaluator_key"
                        label="Template"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Radio.Group
                            onChange={(e) =>
                                setSelectedEval(
                                    evaluators.find((item) => item.key === e.target.value) || null,
                                )
                            }
                        >
                            {evaluators.map((evaluator) => (
                                <Radio.Button key={evaluator.key} value={evaluator.key}>
                                    <div className={classes.radioBtn}>
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
            </Spin>
        </Modal>
    )
}

export default NewEvaluatorModal

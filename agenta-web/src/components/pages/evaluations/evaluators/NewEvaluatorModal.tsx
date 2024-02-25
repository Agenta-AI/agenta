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
import {ArrowLeftOutlined, EditOutlined, InfoCircleOutlined, PlusOutlined} from "@ant-design/icons"
import {Editor} from "@monaco-editor/react"
import {Button, Form, Input, InputNumber, Modal, Switch, Table, Tag, Tooltip, theme} from "antd"
import {Rule} from "antd/es/form"
import {useAtom} from "jotai"
import Image from "next/image"
import React, {useEffect, useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import {ColumnsType} from "antd/es/table"

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
    evalNameContainer: {
        display: "flex",
        alignItems: "center",
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
    evaluatorsTable: {
        maxHeight: 550,
        overflowY: "scroll",
        margin: "2rem 0 1rem",
        border: `1px solid ${theme.colorBorder}`,
        borderRadius: theme.borderRadius,
        "& .ant-table-thead": {
            position: "sticky",
            top: 0,
            zIndex: 1000,
        },
    },
    evalModalBtns: {
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        justifyContent: "flex-end",
    },
    evalBtnContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        width: "100%",
    },
    searchContainer: {
        marginTop: "1rem",
        width: "100%",
        display: "flex",
        justifyContent: "flex-end",
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
        </Form.Item>
    )
}

type Props = {
    onSuccess?: () => void
    initialValues?: EvaluatorConfig
    editMode?: boolean
    setNewEvalModalOpen: (value: React.SetStateAction<boolean>) => void
    newEvalModalConfigOpen: boolean
    setNewEvalModalConfigOpen: React.Dispatch<React.SetStateAction<boolean>>
} & React.ComponentProps<typeof Modal>

const NewEvaluatorModal: React.FC<Props> = ({
    onSuccess,
    editMode = false,
    initialValues,
    setNewEvalModalOpen,
    newEvalModalConfigOpen,
    setNewEvalModalConfigOpen,
    ...props
}) => {
    const classes = useStyles()
    const evaluators = useAtom(evaluatorsAtom)[0].filter((item) => !item.direct_use)
    const [selectedEval, setSelectedEval] = useState<Evaluator | null>(null)
    const [submitLoading, setSubmitLoading] = useState(false)
    const [searchTerm, setSearchTerm] = useState<string>("")
    const appId = useAppId()
    const [form] = Form.useForm()

    const filtered = useMemo(() => {
        if (!searchTerm) return evaluators
        return evaluators.filter((item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, evaluators])

    const handleCloseModal = () => {
        setSearchTerm("")
        setNewEvalModalOpen(false)
    }

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
        if (initialValues) {
            form.setFieldsValue(initialValues)
            setSelectedEval(
                evaluators.find((item) => item.key === initialValues?.evaluator_key) || null,
            )
        }
    }, [newEvalModalConfigOpen])

    const onSubmit = (values: CreateEvaluationConfigData) => {
        setSubmitLoading(true)
        if (!selectedEval?.key) throw new Error("No selected key")
        const data = {
            ...values,
            evaluator_key: selectedEval.key,
            settings_values: values.settings_values || {},
        }
        ;(editMode
            ? updateEvaluatorConfig(initialValues?.id!, data)
            : createEvaluatorConfig(appId, data)
        )
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    const columns: ColumnsType<Evaluator> = [
        {
            title: "Name",
            dataIndex: "name",
            key: "name",
            width: 200,
            render(_, record) {
                return (
                    <>
                        <div className={classes.evalNameContainer}>
                            {record.icon_url && (
                                <Image
                                    src={record.icon_url}
                                    alt="Exact match"
                                    className={classes.evaluationImg}
                                />
                            )}
                            <span>{record.name}</span>
                        </div>
                    </>
                )
            },
        },
        {
            title: "Type",
            dataIndex: "type",
            key: "type",
            render(_, record) {
                const template = Object.keys(record?.settings_template || {})
                    .filter((key) => !!record?.settings_template[key]?.type)
                    .map((key) => ({
                        key,
                        ...record?.settings_template[key]!,
                    }))

                return (
                    <>
                        <Tag color={record.color}>{template[0].type}</Tag>
                    </>
                )
            },
        },
        {
            title: "Description",
            dataIndex: "description",
            key: "description",
            render(_, record) {
                return (
                    <>
                        <div>{record.description}</div>
                    </>
                )
            },
        },
    ]

    return (
        <>
            <Modal
                title="New Evaluator"
                data-cy="new-evaluator-modal"
                width={1000}
                footer={null}
                onCancel={handleCloseModal}
                {...props}
            >
                <div className={classes.searchContainer}>
                    <Input.Search
                        value={searchTerm}
                        onChange={(e) => setSearchTerm(e.target.value)}
                        placeholder="Search"
                        allowClear
                        enterButton
                        style={{
                            maxWidth: 300,
                        }}
                    />
                </div>
                <Table
                    pagination={false}
                    columns={columns}
                    dataSource={filtered}
                    className={classes.evaluatorsTable}
                    onRow={(data, index) => {
                        return {
                            onClick: () => {
                                setNewEvalModalOpen(false)
                                setNewEvalModalConfigOpen(true)
                                setSelectedEval(data)
                            },
                            style: {
                                cursor: "pointer",
                            },
                            "data-cy": `select-new-evaluator-${index}`,
                        }
                    }}
                />
            </Modal>

            <Modal
                open={newEvalModalConfigOpen}
                destroyOnClose
                onOk={form.submit}
                title={editMode ? "Edit your evaluator" : "Configure your evaluator"}
                footer={null}
                data-cy="configure-new-evaluator-modal"
            >
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
                        <Input data-cy="configure-new-evaluator-modal-input" />
                    </Form.Item>

                    {evalFields.map((field) => (
                        <DynamicFormField
                            {...field}
                            key={field.key}
                            name={["settings_values", field.key]}
                        />
                    ))}

                    <Form.Item style={{marginBottom: 0}}>
                        <div className={classes.evalBtnContainer}>
                            {!editMode && (
                                <Button
                                    icon={<ArrowLeftOutlined />}
                                    onClick={() => {
                                        setNewEvalModalConfigOpen(false)
                                        setNewEvalModalOpen(true)
                                    }}
                                    data-cy="configure-new-evaluator-modal-back-btn"
                                >
                                    Back
                                </Button>
                            )}

                            <div className={classes.evalModalBtns}>
                                <Button
                                    type="default"
                                    onClick={() => setNewEvalModalConfigOpen(false)}
                                    data-cy="configure-new-evaluator-modal-cancel-btn"
                                >
                                    Cancel
                                </Button>
                                <Button
                                    type="primary"
                                    icon={editMode ? <EditOutlined /> : <PlusOutlined />}
                                    loading={submitLoading}
                                    onClick={form.submit}
                                    data-cy="configure-new-evaluator-modal-save-btn"
                                >
                                    {editMode ? "Update" : "Save"}
                                </Button>
                            </div>
                        </div>
                    </Form.Item>
                </Form>
            </Modal>
        </>
    )
}

export default NewEvaluatorModal

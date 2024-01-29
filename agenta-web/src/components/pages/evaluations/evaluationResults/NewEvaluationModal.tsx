import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, Variant, LLMRunRateLimit, testset} from "@/lib/Types"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {apiKeyObject, getAllProviderLlmKeys, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {fetchTestsets, fetchVariants} from "@/lib/services/api"
import {CreateEvaluationData, createEvalutaiton} from "@/services/evaluations"
import {PlusOutlined, QuestionCircleOutlined} from "@ant-design/icons"
import {
    Divider,
    Form,
    Modal,
    Select,
    Spin,
    Tag,
    Typography,
    InputNumber,
    Row,
    Col,
    Switch,
    Tooltip,
} from "antd"
import dayjs from "dayjs"
import {useAtom} from "jotai"
import Image from "next/image"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    spinContainer: {
        display: "grid",
        placeItems: "center",
        height: "100%",
    },
    selector: {
        width: 300,
    },
    evaluationImg: {
        width: 20,
        height: 20,
        marginRight: 12,
        filter: theme.isDark ? "invert(1)" : "none",
    },
    configRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    configRowContent: {
        display: "flex",
        alignItems: "center",
    },
    date: {
        fontSize: "0.75rem",
        color: "#8c8c8c",
    },
    tag: {
        transform: "scale(0.8)",
    },
    divider: {
        margin: "1rem -1.5rem",
        width: "unset",
    },
}))

type Props = {
    onSuccess?: () => void
} & React.ComponentProps<typeof Modal>

const NewEvaluationModal: React.FC<Props> = ({onSuccess, ...props}) => {
    const classes = useStyles()
    const appId = useAppId()
    const [fetching, setFetching] = useState(false)
    const [testSets, setTestSets] = useState<testset[]>([])
    const [variants, setVariants] = useState<Variant[]>([])
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [evaluators] = useAtom(evaluatorsAtom)
    const [submitLoading, setSubmitLoading] = useState(false)
    const [showRateLimitInputs, setShowRateLimitInputs] = useState(false)
    const [form] = Form.useForm()

    useEffect(() => {
        setFetching(true)
        form.resetFields()
        Promise.all([fetchTestsets(appId), fetchVariants(appId)])
            .then(([testSets, variants]) => {
                setTestSets(testSets)
                setVariants(variants)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }, [props.open, appId])

    const [rateLimitValues, setRateLimitValues] = useState<LLMRunRateLimit>({
        batch_size: 10,
        max_retries: 3,
        retry_delay: 3,
        delay_between_batches: 5,
    })
    const onRateLimitInputChange = (field: keyof LLMRunRateLimit, value: number) => {
        setRateLimitValues((prevValues: any) => ({...prevValues, [field]: value}))
    }
    const onRateLimitSwitchChange = (checked: boolean) => {
        setShowRateLimitInputs(checked)
    }

    const onSubmit = (values: CreateEvaluationData) => {
        // redirect if no llm keys and an AI Critique config is selected
        if (
            values.evaluators_configs.some(
                (id) =>
                    evaluatorConfigs.find((config) => config.id === id)?.evaluator_key ===
                    "auto_ai_critique",
            ) &&
            redirectIfNoLLMKeys()
        )
            return
        setSubmitLoading(true)
        createEvalutaiton(appId, {
            testset_id: values.testset_id,
            variant_ids: values.variant_ids,
            evaluators_configs: values.evaluators_configs,
            rate_limit: rateLimitValues,
            lm_providers_keys: apiKeyObject(),
        })
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
            <Divider className={classes.divider} />
            <Spin spinning={fetching}>
                <Form
                    requiredMark={false}
                    form={form}
                    name="new-evaluation"
                    onFinish={onSubmit}
                    layout="vertical"
                >
                    <Form.Item
                        name="testset_id"
                        label="Which testset do you want to use?"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select placeholder="Select testset" data-cy="select-testset-group">
                            {testSets.map((testSet) => (
                                <Select.Option
                                    key={testSet._id}
                                    value={testSet._id}
                                    data-cy="select-testset-option"
                                >
                                    {testSet.name}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="variant_ids"
                        label="Which variants you would like to evaluate?"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select
                            mode="multiple"
                            placeholder="Select variants"
                            data-cy="select-variant-group"
                        >
                            {variants.map((variant) => (
                                <Select.Option
                                    key={variant.variantId}
                                    value={variant.variantId}
                                    data-cy="select-variant-option"
                                >
                                    {variant.variantName}
                                </Select.Option>
                            ))}
                        </Select>
                    </Form.Item>

                    <Form.Item
                        name="evaluators_configs"
                        label="Which evaluators you would like to evaluate on?"
                    >
                        <Select
                            mode="multiple"
                            placeholder="Select evaluators"
                            showSearch
                            filterOption={(input, option) => {
                                const config = evaluatorConfigs.find(
                                    (item) => item.id === option?.value,
                                )
                                return (
                                    config?.name.toLowerCase().includes(input.toLowerCase()) ||
                                    false
                                )
                            }}
                            data-cy="select-evaluators-group"
                        >
                            {evaluatorConfigs.map((config) => {
                                const evaluator = evaluators.find(
                                    (item) => item.key === config.evaluator_key,
                                )!
                                return (
                                    <Select.Option
                                        key={config.id}
                                        value={config.id}
                                        data-cy="select-evaluators-option"
                                    >
                                        <div className={classes.configRow}>
                                            <div className={classes.configRowContent}>
                                                {evaluator.icon_url && (
                                                    <Image
                                                        src={evaluator.icon_url}
                                                        alt={evaluator.name}
                                                        className={classes.evaluationImg}
                                                    />
                                                )}
                                                <Typography.Text>{config.name}</Typography.Text>
                                                <Tag
                                                    className={classes.tag}
                                                    color={evaluator.color}
                                                >
                                                    {evaluator.name}
                                                </Tag>
                                            </div>
                                            <Typography.Text className={classes.date}>
                                                {dayjs(config.created_at).format("DD MMM YY")}
                                            </Typography.Text>
                                        </div>
                                    </Select.Option>
                                )
                            })}
                        </Select>
                    </Form.Item>
                    <Form.Item
                        label="Advanced Rate-Limit Configuration"
                        style={{marginBottom: "0"}}
                    >
                        <Switch checked={showRateLimitInputs} onChange={onRateLimitSwitchChange} />
                    </Form.Item>

                    {showRateLimitInputs && (
                        <Form.Item required>
                            <Divider className={classes.divider} />
                            <Row gutter={16}>
                                <Col span={12}>
                                    <Form.Item
                                        label={
                                            <>
                                                Batch Size&nbsp;
                                                <Tooltip title="Number of testset to have in each batch">
                                                    <QuestionCircleOutlined />
                                                </Tooltip>
                                            </>
                                        }
                                        name="batch_size"
                                        style={{marginBottom: "0"}}
                                        rules={[
                                            {
                                                validator: (_, value) => {
                                                    if (value !== null) {
                                                        return Promise.resolve()
                                                    }
                                                    return Promise.reject("This field is required")
                                                },
                                            },
                                        ]}
                                    >
                                        <InputNumber
                                            defaultValue={rateLimitValues.batch_size}
                                            onChange={(value: number | null) =>
                                                value !== null &&
                                                onRateLimitInputChange("batch_size", value)
                                            }
                                            style={{width: "100%"}}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item
                                        label={
                                            <>
                                                Max Retries&nbsp;
                                                <Tooltip title="Maximum number of times to retry the failed llm call">
                                                    <QuestionCircleOutlined />
                                                </Tooltip>
                                            </>
                                        }
                                        name="max_retries"
                                        rules={[
                                            {
                                                validator: (_, value) => {
                                                    if (value !== null) {
                                                        return Promise.resolve()
                                                    }
                                                    return Promise.reject("This field is required")
                                                },
                                            },
                                        ]}
                                    >
                                        <InputNumber
                                            defaultValue={rateLimitValues.max_retries}
                                            onChange={(value: number | null) =>
                                                value !== null &&
                                                onRateLimitInputChange("max_retries", value)
                                            }
                                            style={{width: "100%"}}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item
                                        label={
                                            <>
                                                Retry Delay&nbsp;
                                                <Tooltip title="Delay before retrying the failed llm call (in seconds)">
                                                    <QuestionCircleOutlined />
                                                </Tooltip>
                                            </>
                                        }
                                        style={{marginBottom: "0"}}
                                        name="retry_delay"
                                        rules={[
                                            {
                                                validator: (_, value) => {
                                                    if (value !== null) {
                                                        return Promise.resolve()
                                                    }
                                                    return Promise.reject("This field is required")
                                                },
                                            },
                                        ]}
                                    >
                                        <InputNumber
                                            defaultValue={rateLimitValues.retry_delay}
                                            onChange={(value: number | null) =>
                                                value !== null &&
                                                onRateLimitInputChange("retry_delay", value)
                                            }
                                            style={{width: "100%"}}
                                        />
                                    </Form.Item>
                                </Col>
                                <Col span={12}>
                                    <Form.Item
                                        label={
                                            <>
                                                Delay Between Batches&nbsp;
                                                <Tooltip title="Delay to run batches (in seconds)">
                                                    <QuestionCircleOutlined />
                                                </Tooltip>
                                            </>
                                        }
                                        name="delay_between_batches"
                                        style={{marginBottom: "0"}}
                                        rules={[
                                            {
                                                validator: (_, value) => {
                                                    if (value !== null) {
                                                        return Promise.resolve()
                                                    }
                                                    return Promise.reject("This field is required")
                                                },
                                            },
                                        ]}
                                    >
                                        <InputNumber
                                            defaultValue={rateLimitValues.delay_between_batches}
                                            onChange={(value: number | null) =>
                                                value !== null &&
                                                onRateLimitInputChange(
                                                    "delay_between_batches",
                                                    value,
                                                )
                                            }
                                            style={{width: "100%"}}
                                        />
                                    </Form.Item>
                                </Col>
                            </Row>
                        </Form.Item>
                    )}
                </Form>
            </Spin>
        </Modal>
    )
}

export default NewEvaluationModal

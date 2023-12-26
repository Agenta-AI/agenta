import {useAppId} from "@/hooks/useAppId"
import {Evaluator, EvaluatorConfig, JSSTheme, Variant, testset} from "@/lib/Types"
import {fetchTestsets, fetchVariants} from "@/lib/services/api"
import {
    CreateEvaluationData,
    createEvalutaiton,
    fetchAllEvaluatorConfigs,
    fetchAllEvaluators,
} from "@/services/evaluations"
import {PlusOutlined} from "@ant-design/icons"
import {Form, Modal, Select, Spin, Tag, Typography} from "antd"
import dayjs from "dayjs"
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
        color: "#888",
    },
    tag: {
        transform: "scale(0.8)",
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
    const [evaluatorConfigs, setEvaluatorConfigs] = useState<EvaluatorConfig[]>([])
    const [evaluators, setEvaluators] = useState<Evaluator[]>([])
    const [submitLoading, setSubmitLoading] = useState(false)
    const [form] = Form.useForm()

    useEffect(() => {
        setFetching(true)
        form.resetFields()
        Promise.all([
            fetchTestsets(appId),
            fetchVariants(appId),
            fetchAllEvaluatorConfigs(appId),
            fetchAllEvaluators(),
        ])
            .then(([testSets, variants, evaluatorConfigs, evaluators]) => {
                setTestSets(testSets)
                setVariants(variants)
                setEvaluatorConfigs(evaluatorConfigs)
                setEvaluators(evaluators)
            })
            .catch(console.error)
            .finally(() => setFetching(false))
    }, [props.open, appId])

    const onSubmit = (values: CreateEvaluationData) => {
        setSubmitLoading(true)
        createEvalutaiton(appId, values)
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
                    name="new-evaluation"
                    onFinish={onSubmit}
                    layout="vertical"
                >
                    <Form.Item
                        name="testset_id"
                        label="Which testset do you want to use?"
                        rules={[{required: true, message: "This field is required"}]}
                    >
                        <Select placeholder="Select testset">
                            {testSets.map((testSet) => (
                                <Select.Option key={testSet._id} value={testSet._id}>
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
                        <Select mode="multiple" placeholder="Select variants">
                            {variants.map((variant) => (
                                <Select.Option key={variant.variantId} value={variant.variantId}>
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
                        >
                            {evaluatorConfigs.map((config) => {
                                const evaluator = evaluators.find(
                                    (item) => item.key === config.evaluator_key,
                                )!
                                return (
                                    <Select.Option key={config.id} value={config.id}>
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
                </Form>
            </Spin>
        </Modal>
    )
}

export default NewEvaluationModal

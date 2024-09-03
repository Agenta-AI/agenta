import React, {useEffect, useState} from "react"
import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, Variant, testset} from "@/lib/Types"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {apiKeyObject, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {fetchVariants} from "@/services/api"
import {CreateEvaluationData, createEvalutaiton} from "@/services/evaluations/api"
import {fetchTestsets} from "@/services/testsets/api"
import {Button, Divider, Form, Modal, Select, Spin} from "antd"
import {useAtom} from "jotai"
import {createUseStyles} from "react-jss"
import {ChartDonut, Plus} from "@phosphor-icons/react"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    spinContainer: {
        display: "grid",
        placeItems: "center",
        height: "100%",
    },
    selector: {
        width: 300,
    },
    configRow: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
    },
    divider: {
        margin: "1rem -1.5rem",
        width: "unset",
    },
    container: {
        "& .ant-modal-footer": {
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
        },
    },
    modalContainer: {
        display: "flex",
        alignItems: "center",
    },
    selectItemLabels: {
        fontSize: theme.fontSizeSM,
        lineHeight: theme.lineHeightSM,
        color: theme.colorTextDescription,
        margin: "0px 5px",
    },
}))

type Props = {
    onSuccess?: () => void
    onOpenEvaluatorModal: () => void
} & React.ComponentProps<typeof Modal>

const NewEvaluationModal: React.FC<Props> = ({onSuccess, onOpenEvaluatorModal, ...props}) => {
    const classes = useStyles()
    const appId = useAppId()
    const [fetching, setFetching] = useState(false)
    const [testSets, setTestSets] = useState<testset[]>([])
    const [variants, setVariants] = useState<Variant[]>([])
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [evaluators] = useAtom(evaluatorsAtom)
    const [submitLoading, setSubmitLoading] = useState(false)
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

    const rateLimitValues = {
        batch_size: 10,
        max_retries: 3,
        retry_delay: 3,
        delay_between_batches: 5,
    }
    const correctAnswerColumn = "correct_answer"

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
            correct_answer_column: correctAnswerColumn,
        })
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    return (
        <Modal
            title="New Evaluation"
            onOk={form.submit}
            okText="Start evaluation"
            okButtonProps={{
                icon: <ChartDonut size={14} />,
                loading: submitLoading,
                className: classes.modalContainer,
            }}
            className={classes.container}
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
                                    <div className={classes.configRow}>
                                        <span>{variant.variantName}</span>
                                        <span className={classes.selectItemLabels}>
                                            #{variant.variantId.split("-")[0]}
                                        </span>
                                    </div>
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
                            dropdownRender={(menu) => (
                                <>
                                    <Button
                                        className="w-full flex items-center justify-center"
                                        type="primary"
                                        icon={<Plus size={14} />}
                                        onClick={onOpenEvaluatorModal}
                                    >
                                        Create new Evaluator
                                    </Button>
                                    <Divider className="my-1" />
                                    {menu}
                                </>
                            )}
                        >
                            {evaluatorConfigs.map((config) => {
                                const evaluator = evaluators.find(
                                    (item) => item.key === config.evaluator_key,
                                )!

                                if (!evaluator) {
                                    return null
                                }

                                return (
                                    <Select.Option
                                        key={config.id}
                                        value={config.id}
                                        data-cy="select-evaluators-option"
                                    >
                                        <div className={classes.configRow}>
                                            <span>{config.name}</span>
                                            <span className={classes.selectItemLabels}>
                                                {evaluator.name}
                                            </span>
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

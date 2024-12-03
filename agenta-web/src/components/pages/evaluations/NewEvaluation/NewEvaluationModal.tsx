import {useAppId} from "@/hooks/useAppId"
import {
    JSSTheme,
    LLMRunRateLimit,
    TestSet,
    testset,
    TestsetCreationMode,
    Variant,
} from "@/lib/Types"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {apiKeyObject, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {fetchSingleProfile, fetchVariants} from "@/services/api"
import {CreateEvaluationData, createEvalutaiton} from "@/services/evaluations/api"
import {fetchTestsets} from "@/services/testsets/api"
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
    Input,
    Row,
    Col,
    Switch,
    Tooltip,
    Space,
} from "antd"
import dayjs from "dayjs"
import {useAtom} from "jotai"
import Image from "next/image"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import SelectTestsetSection from "./SelectTestsetSection"
import SelectVariantSection from "./SelectVariantSection"
import SelectEvaluatorSection from "./SelectEvaluatorSection"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        height: 800,
        overflowY: "hidden",
        "& > div": {
            height: "100%",
        },
        "& .ant-modal-content": {
            height: "100%",
            "& .ant-modal-body": {
                height: "100%",
                overflowY: "auto",
                paddingTop: theme.padding,
                paddingBottom: theme.padding,
            },
        },
    },
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
    collapseContainer: {
        "& .ant-collapse-header": {
            alignItems: "center !important",
        },
        "& .ant-collapse-content": {
            height: 500,
            overflowY: "auto",
            "& .ant-collapse-content-box": {
                padding: 0,
            },
        },
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
    const [usernames, setUsernames] = useState<Record<string, string>>({})
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [evaluators] = useAtom(evaluatorsAtom)
    const [submitLoading, setSubmitLoading] = useState(false)
    const [showAdvancedConfig, setshowAdvancedConfig] = useState(false)
    const [form] = Form.useForm()

    useEffect(() => {
        const fetchData = async () => {
            setFetching(true)
            form.resetFields()

            try {
                const [testSets, variants] = await Promise.all([
                    fetchTestsets(),
                    fetchVariants(appId),
                ])

                const usernameMap: Record<string, string> = {}
                const uniqueModifiedByIds = Array.from(
                    new Set(variants.map((variant) => variant.modifiedById)),
                )

                const profiles = await Promise.all(
                    uniqueModifiedByIds.map((id) => fetchSingleProfile(id)),
                )

                profiles.forEach((profile, index) => {
                    const id = uniqueModifiedByIds[index]
                    usernameMap[id] = profile?.username || "-"
                })

                setTestSets(testSets)
                setVariants(variants)
                setUsernames(usernameMap)
            } catch (error) {
                console.error(error)
            } finally {
                setFetching(false)
            }
        }

        fetchData()
    }, [props.open, appId])

    const [rateLimitValues, setRateLimitValues] = useState<LLMRunRateLimit>({
        batch_size: 10,
        max_retries: 3,
        retry_delay: 3,
        delay_between_batches: 5,
    })
    const [correctAnswerColumn, setCorrectAnswerColumn] = useState<string>("correct_answer")
    const onRateLimitInputChange = (field: keyof LLMRunRateLimit, value: number) => {
        setRateLimitValues((prevValues: any) => ({...prevValues, [field]: value}))
    }
    const onAdvanceConfigSwitchChange = (checked: boolean) => {
        setshowAdvancedConfig(checked)
    }
    const onCorrectAnswerColumnChange = (value: string) => {
        setCorrectAnswerColumn(value)
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
            okText="Create"
            centered
            width={1200}
            className={classes.modalContainer}
            okButtonProps={{icon: <PlusOutlined />, loading: submitLoading}}
            {...props}
        >
            <Spin spinning={fetching} className="w-full">
                <Space direction="vertical" size={16} className="w-full">
                    <SelectTestsetSection
                        testSets={testSets}
                        className={classes.collapseContainer}
                    />
                    <SelectVariantSection
                        variants={variants}
                        usernames={usernames}
                        className={classes.collapseContainer}
                    />
                    <SelectEvaluatorSection
                        evaluators={evaluators}
                        evaluatorConfigs={evaluatorConfigs}
                        className={classes.collapseContainer}
                    />
                </Space>
            </Spin>
        </Modal>
    )
}

export default NewEvaluationModal

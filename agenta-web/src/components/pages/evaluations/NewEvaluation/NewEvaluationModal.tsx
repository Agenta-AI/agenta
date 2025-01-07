import {useAppId} from "@/hooks/useAppId"
import {JSSTheme, LLMRunRateLimit, testset, Variant} from "@/lib/Types"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {apiKeyObject, redirectIfNoLLMKeys} from "@/lib/helpers/utils"
import {fetchSingleProfile, fetchVariants} from "@/services/api"
import {createEvalutaiton} from "@/services/evaluations/api"
import {fetchTestsets} from "@/services/testsets/api"
import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Modal, Spin, Space, message, Button} from "antd"
import {useAtom} from "jotai"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import SelectTestsetSection from "./SelectTestsetSection"
import SelectVariantSection from "./SelectVariantSection"
import SelectEvaluatorSection from "./SelectEvaluatorSection"
import {dynamicComponent} from "@/lib/helpers/dynamic"
import {useVaultSecret} from "@/hooks/useVaultSecret"

const AdvancedSettingsPopover: any = dynamicComponent(
    "pages/evaluations/NewEvaluation/AdvancedSettingsPopover",
)

const useStyles = createUseStyles((theme: JSSTheme) => ({
    modalContainer: {
        height: 800,
        overflowY: "hidden",
        "& > div": {
            height: "100%",
        },
        "& .ant-modal-content": {
            height: "100%",
            display: "flex",
            flexDirection: "column",
            "& .ant-modal-body": {
                overflowY: "auto",
                flex: 1,
                paddingTop: theme.padding,
                paddingBottom: theme.padding,
            },
        },
    },
    collapseContainer: {
        "& .ant-collapse-header": {
            alignItems: "center !important",
        },
        "& .ant-collapse-content": {
            maxHeight: 400,
            height: "100%",
            overflowY: "auto",
            "& .ant-collapse-content-box": {
                padding: 0,
            },
        },
        "& .ant-input-group-addon button": {
            height: 30,
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
    const [selectedTestsetId, setSelectedTestsetId] = useState("")
    const [selectedVariantIds, setSelectedVariantIds] = useState<string[]>([])
    const [selectedEvalConfigs, setSelectedEvalConfigs] = useState<string[]>([])
    const {secrets} = useVaultSecret()

    const [activePanel, setActivePanel] = useState<string | null>("testsetPanel")
    const handlePanelChange = (key: string | string[]) => {
        setActivePanel((prevKey) => (prevKey === key ? null : (key as string)))
    }

    useEffect(() => {
        const fetchData = async () => {
            setFetching(true)
            setSelectedEvalConfigs([])
            setSelectedTestsetId("")
            setSelectedVariantIds([])

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

    const validateSubmission = () => {
        if (!selectedTestsetId) {
            message.error("Please select a test set")
            return false
        }
        if (selectedVariantIds.length === 0) {
            message.error("Please select app variant")
            return false
        }
        if (selectedEvalConfigs.length === 0) {
            message.error("Please select evaluator configuration")
            return false
        }
        if (
            selectedEvalConfigs.some(
                (id) =>
                    evaluatorConfigs.find((config) => config.id === id)?.evaluator_key ===
                    "auto_ai_critique",
            ) &&
            redirectIfNoLLMKeys()
        ) {
            message.error("LLM keys are required for AI Critique configuration")
            return false
        }
        return true
    }

    const onSubmit = () => {
        if (!validateSubmission()) return

        setSubmitLoading(true)
        createEvalutaiton(appId, {
            testset_id: selectedTestsetId,
            variant_ids: selectedVariantIds,
            evaluators_configs: selectedEvalConfigs,
            rate_limit: rateLimitValues,
            lm_providers_keys: apiKeyObject(secrets),
            correct_answer_column: correctAnswerColumn,
        })
            .then(onSuccess)
            .catch(console.error)
            .finally(() => setSubmitLoading(false))
    }

    return (
        <Modal
            title={
                <div className="w-full flex items-center justify-between">
                    <div>New Evaluation</div>
                    <Space>
                        <AdvancedSettingsPopover
                            correctAnswerColumn={correctAnswerColumn}
                            setCorrectAnswerColumn={setCorrectAnswerColumn}
                            setRateLimitValues={setRateLimitValues}
                            rateLimitValues={rateLimitValues}
                        />
                        <Button
                            type="text"
                            onClick={() => props.onCancel?.({} as any)}
                            icon={<CloseOutlined />}
                        />
                    </Space>
                </div>
            }
            onOk={onSubmit}
            okText="Create"
            centered
            closeIcon={null}
            destroyOnClose
            maskClosable={false}
            width={1200}
            className={classes.modalContainer}
            okButtonProps={{icon: <PlusOutlined />, loading: submitLoading}}
            {...props}
        >
            <Spin spinning={fetching} className="w-full">
                <Space direction="vertical" size={16} className="w-full">
                    <SelectTestsetSection
                        activePanel={activePanel}
                        handlePanelChange={handlePanelChange}
                        testSets={testSets}
                        selectedTestsetId={selectedTestsetId}
                        setSelectedTestsetId={setSelectedTestsetId}
                        className={classes.collapseContainer}
                    />
                    <SelectVariantSection
                        activePanel={activePanel}
                        handlePanelChange={handlePanelChange}
                        variants={variants}
                        usernames={usernames}
                        selectedVariantIds={selectedVariantIds}
                        setSelectedVariantIds={setSelectedVariantIds}
                        className={classes.collapseContainer}
                    />
                    <SelectEvaluatorSection
                        activePanel={activePanel}
                        handlePanelChange={handlePanelChange}
                        evaluators={evaluators}
                        evaluatorConfigs={evaluatorConfigs}
                        selectedEvalConfigs={selectedEvalConfigs}
                        setSelectedEvalConfigs={setSelectedEvalConfigs}
                        className={classes.collapseContainer}
                    />
                </Space>
            </Spin>
        </Modal>
    )
}

export default NewEvaluationModal

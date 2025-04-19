// @ts-nocheck
import {useEffect, useMemo, useState} from "react"

import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Button, message, Modal, Space, Spin} from "antd"
import {useAtom} from "jotai"
import dynamic from "next/dynamic"
import {createUseStyles} from "react-jss"

import {useAppsData} from "@/oss/contexts/app.context"
import {useAppId} from "@/oss/hooks/useAppId"
import {useVaultSecret} from "@/oss/hooks/useVaultSecret"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {redirectIfNoLLMKeys} from "@/oss/lib/helpers/utils"
import {useVariants} from "@/oss/lib/hooks/useVariants"
import {JSSTheme, LLMRunRateLimit, testset} from "@/oss/lib/Types"
import {createEvaluation} from "@/oss/services/evaluations/api"
import {fetchTestsets} from "@/oss/services/testsets/api"

import SelectEvaluatorSection from "./SelectEvaluatorSection"
import SelectTestsetSection from "./SelectTestsetSection"
import SelectVariantSection from "./SelectVariantSection"

const AdvancedSettingsPopover: any = dynamic(
    () => import("@/oss/components/pages/evaluations/NewEvaluation/AdvancedSettingsPopover"),
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
    const {currentApp} = useAppsData()
    const appId = useAppId()
    const [fetching, setFetching] = useState(false)
    const [testSets, setTestSets] = useState<testset[]>([])
    const [evaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [evaluators] = useAtom(evaluatorsAtom)
    const [submitLoading, setSubmitLoading] = useState(false)
    const [selectedTestsetId, setSelectedTestsetId] = useState("")
    const [selectedVariantRevisionIds, setSelectedVariantRevisionIds] = useState<string[]>([])
    const [selectedEvalConfigs, setSelectedEvalConfigs] = useState<string[]>([])

    const {data, isLoading: isVariantLoading} = useVariants(currentApp)({appId})
    const variants = useMemo(() => data?.variants, [data?.variants])
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
            setSelectedVariantRevisionIds([])

            try {
                const testSets = await fetchTestsets()

                setTestSets(testSets)
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

    const validateSubmission = async () => {
        if (!selectedTestsetId) {
            message.error("Please select a test set")
            return false
        }
        if (selectedVariantRevisionIds.length === 0) {
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
            (await redirectIfNoLLMKeys({secrets}))
        ) {
            message.error("LLM keys are required for AI Critique configuration")
            return false
        }
        return true
    }

    const onSubmit = () => {
        if (!validateSubmission()) return

        setSubmitLoading(true)
        createEvaluation(appId, {
            testset_id: selectedTestsetId,
            revisions_ids: selectedVariantRevisionIds,
            evaluators_configs: selectedEvalConfigs,
            rate_limit: rateLimitValues,
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
                        variants={variants || []}
                        selectedVariantRevisionIds={selectedVariantRevisionIds}
                        setSelectedVariantRevisionIds={setSelectedVariantRevisionIds}
                        className={classes.collapseContainer}
                        isVariantLoading={isVariantLoading}
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

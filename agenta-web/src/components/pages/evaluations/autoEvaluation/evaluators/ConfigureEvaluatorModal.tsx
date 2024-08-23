import {useAppId} from "@/hooks/useAppId"
import {JSSTheme} from "@/lib/Types"
import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Input, Modal, Radio, Space, Typography} from "antd"
import React, {useEffect, useState} from "react"
import {createUseStyles} from "react-jss"
import {evaluatorConfigsAtom, evaluatorsAtom} from "@/lib/atoms/evaluation"
import {fetchAllEvaluatorConfigs, fetchAllEvaluators} from "@/services/evaluations/api"
import {useAtom} from "jotai"
import EvaluatorCard from "./EvaluatorCard"
import EvaluatorList from "./EvaluatorList"

type ConfigureEvaluatorModalProps = {} & React.ComponentProps<typeof Modal>

const useStyles = createUseStyles((theme: JSSTheme) => ({
    titleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1": {
            fontSize: theme.fontSizeLG,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
        },
    },
    bodyContainer: {
        padding: `${theme.padding}px 0`,
        "& > div:nth-of-type(1)": {
            backgroundColor: theme.colorBgContainer,
            position: "sticky",
            top: 0,
        },
        "& > div:nth-of-type(2)": {
            height: 800,
            overflowY: "auto",
        },
    },
    radioBtnContainer: {
        display: "flex",
        alignItems: "center",
        gap: theme.marginXS,
        "& .ant-radio-button-wrapper": {
            borderRadius: theme.borderRadius,
            borderInlineStartWidth: "initial",
            "&:before": {
                width: 0,
            },
            "&:not(.ant-radio-button-wrapper-checked)": {
                border: "none",
                "&:hover": {
                    backgroundColor: theme.colorBgTextHover,
                },
            },
        },
    },
}))

const ConfigureEvaluatorModal = ({...props}: ConfigureEvaluatorModalProps) => {
    const classes = useStyles()
    const appId = useAppId()
    const setEvaluators = useAtom(evaluatorsAtom)[1]
    const [evaluatorConfigs, setEvaluatorConfigs] = useAtom(evaluatorConfigsAtom)
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useState("card")
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    useEffect(() => {
        Promise.all([fetchAllEvaluators(), fetchAllEvaluatorConfigs(appId)]).then(
            ([evaluators, configs]) => {
                setEvaluators(evaluators)
                setEvaluatorConfigs(configs)
            },
        )
    }, [appId])

    return (
        <Modal
            footer={null}
            width={1200}
            closeIcon={null}
            title={
                <div className={classes.titleContainer}>
                    <Typography.Title>Configure evaluators</Typography.Title>

                    <Space>
                        <Button type="primary" icon={<PlusOutlined />}>
                            Create new evaluator
                        </Button>
                        <CloseOutlined onClick={() => props.onCancel?.({} as any)} />
                    </Space>
                </div>
            }
            {...props}
        >
            <div className={classes.bodyContainer}>
                <div>
                    <div className="flex items-center justify-between">
                        <Radio.Group
                            defaultValue={"view_all"}
                            className={classes.radioBtnContainer}
                            onChange={(e) => setSelectedEvaluatorCategory(e.target.value)}
                        >
                            <Radio.Button value={"view_all"}>View all</Radio.Button>
                            <Divider type="vertical" />
                            {["RAG", "Classifiers", "Similarity", "AI / LLM", "Functional"].map(
                                (val, idx) => (
                                    <Radio.Button key={idx} value={val}>
                                        {val}
                                    </Radio.Button>
                                ),
                            )}
                        </Radio.Group>
                        <Space>
                            <Input.Search style={{width: 400}} placeholder="Search" allowClear />
                            <Radio.Group
                                defaultValue={evaluatorsDisplay}
                                onChange={(e) => setEvaluatorsDisplay(e.target.value)}
                            >
                                <Radio.Button value="list">
                                    <Table size={16} className="h-full" />
                                </Radio.Button>
                                <Radio.Button value="card">
                                    <Cards size={16} className="h-full" />
                                </Radio.Button>
                            </Radio.Group>
                        </Space>
                    </div>
                    <Divider className="my-4" />
                </div>

                <div>
                    {evaluatorsDisplay === "list" ? (
                        <EvaluatorList evaluatorConfigs={evaluatorConfigs} />
                    ) : (
                        <EvaluatorCard evaluatorConfigs={evaluatorConfigs} />
                    )}
                </div>
            </div>
        </Modal>
    )
}

export default ConfigureEvaluatorModal

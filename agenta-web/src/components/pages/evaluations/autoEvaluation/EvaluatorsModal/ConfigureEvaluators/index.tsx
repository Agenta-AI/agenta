import {EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Input, Radio, Space, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluatorCard from "./EvaluatorCard"
import EvaluatorList from "./EvaluatorList"

type ConfigureEvaluatorModalProps = {
    evaluatorConfigs: EvaluatorConfig[]
    handleOnCancel: () => void
    setCurrent: React.Dispatch<React.SetStateAction<number>>
}

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
    header: {
        display: "flex",
        flexDirection: "column",
        gap: theme.padding,
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

const ConfigureEvaluatorModal = ({
    evaluatorConfigs,
    handleOnCancel,
    setCurrent,
}: ConfigureEvaluatorModalProps) => {
    const classes = useStyles()
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useState("card")
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    return (
        <div>
            <div className={classes.header}>
                <div className={classes.titleContainer}>
                    <Typography.Title>Configure evaluators</Typography.Title>

                    <Space>
                        <Button
                            type="primary"
                            icon={<PlusOutlined />}
                            onClick={() => setCurrent(1)}
                        >
                            Create new evaluator
                        </Button>
                        <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
                    </Space>
                </div>
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
            </div>

            <div className="h-[650px] overflow-y-auto">
                {evaluatorsDisplay === "list" ? (
                    <EvaluatorList evaluatorConfigs={evaluatorConfigs} />
                ) : (
                    <EvaluatorCard evaluatorConfigs={evaluatorConfigs} />
                )}
            </div>
        </div>
    )
}

export default ConfigureEvaluatorModal

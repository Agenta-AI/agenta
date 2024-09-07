import {Evaluator, EvaluatorConfig, JSSTheme} from "@/lib/Types"
import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Flex, Input, Radio, Space, Spin, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import EvaluatorCard from "./EvaluatorCard"
import EvaluatorList from "./EvaluatorList"

type EvaluatorsProps = {
    evaluatorConfigs: EvaluatorConfig[]
    handleOnCancel: () => void
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    fetchingEvalConfigs: boolean
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<EvaluatorConfig | null>>
    onSuccess: () => void
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    titleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& .ant-typography": {
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

const Evaluators = ({
    evaluatorConfigs,
    handleOnCancel,
    setCurrent,
    setSelectedEvaluator,
    fetchingEvalConfigs,
    setEditMode,
    setEditEvalEditValues,
    onSuccess,
}: EvaluatorsProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useState("card")
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    const filteredEvalConfigs = useMemo(() => {
        if (!searchTerm) return evaluatorConfigs
        return evaluatorConfigs.filter((item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, evaluatorConfigs])

    return (
        <div>
            <div className={classes.header}>
                <div className={classes.titleContainer}>
                    <Typography.Text>Configure evaluators</Typography.Text>

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
                        <Flex gap={8}>
                            <Input.Search
                                style={{width: 400}}
                                placeholder="Search"
                                allowClear
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
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
                        </Flex>
                    </div>
                    <Divider className="my-4" />
                </div>
            </div>

            <Spin spinning={fetchingEvalConfigs}>
                {evaluatorsDisplay === "list" ? (
                    <EvaluatorList evaluatorConfigs={filteredEvalConfigs} />
                ) : (
                    <EvaluatorCard
                        evaluatorConfigs={filteredEvalConfigs}
                        setEditMode={setEditMode}
                        setCurrent={setCurrent}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setEditEvalEditValues={setEditEvalEditValues}
                        onSuccess={onSuccess}
                    />
                )}
            </Spin>
        </div>
    )
}

export default Evaluators

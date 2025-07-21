import {useMemo, useState} from "react"

import {CloseOutlined, PlusOutlined} from "@ant-design/icons"
import {Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Flex, Input, Radio, Space, Spin, Typography} from "antd"
import {useAtom} from "jotai"
import {createUseStyles} from "react-jss"

import {evaluatorsAtom} from "@/oss/lib/atoms/evaluation"
import {getEvaluatorTags} from "@/oss/lib/helpers/evaluate"
import {Evaluator, EvaluatorConfig, JSSTheme} from "@/oss/lib/Types"

import EvaluatorCard from "./EvaluatorCard"
import EvaluatorList from "./EvaluatorList"

interface EvaluatorsProps {
    evaluatorConfigs: EvaluatorConfig[]
    handleOnCancel: () => void
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    fetchingEvalConfigs: boolean
    setEditMode: React.Dispatch<React.SetStateAction<boolean>>
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    setEditEvalEditValues: React.Dispatch<React.SetStateAction<EvaluatorConfig | null>>
    onSuccess: () => void
    setEvaluatorsDisplay: any
    evaluatorsDisplay: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    titleContainer: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading4,
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
            borderInlineStartWidth: "1px",
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
    setCloneConfig,
    setEvaluatorsDisplay,
    evaluatorsDisplay,
}: EvaluatorsProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const evaluatorTags = getEvaluatorTags()
    const evaluators = useAtom(evaluatorsAtom)[0]
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    const updatedEvaluatorConfigs = useMemo(() => {
        return evaluatorConfigs.map((config) => {
            const matchingEvaluator = evaluators.find(
                (evaluator) => evaluator.key === config.evaluator_key,
            )
            return matchingEvaluator ? {...config, tags: matchingEvaluator.tags} : config
        })
    }, [evaluatorConfigs, evaluators])

    const filteredEvaluators = useMemo(() => {
        let filtered = updatedEvaluatorConfigs

        if (selectedEvaluatorCategory !== "view_all") {
            filtered = filtered.filter((item) => item.tags?.includes(selectedEvaluatorCategory))
        }

        if (searchTerm) {
            filtered = filtered.filter((item) =>
                item.name.toLowerCase().includes(searchTerm.toLowerCase()),
            )
        }

        return filtered
    }, [searchTerm, selectedEvaluatorCategory, updatedEvaluatorConfigs])

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
                    <div className="flex items-center justify-between gap-4">
                        <Radio.Group
                            defaultValue={selectedEvaluatorCategory}
                            className={classes.radioBtnContainer}
                            onChange={(e) => setSelectedEvaluatorCategory(e.target.value)}
                        >
                            <Radio.Button value={"view_all"} className="text-nowrap">
                                View all
                            </Radio.Button>
                            <Divider type="vertical" className="h-7 !mx-1" />
                            {evaluatorTags.map((val, idx) => (
                                <Radio.Button key={idx} value={val.value} className="text-nowrap">
                                    {val.label}
                                </Radio.Button>
                            ))}
                        </Radio.Group>

                        <Flex gap={8}>
                            <Input.Search
                                className="xl:w-[400px] lg:w-[350px] lg:block hidden shrink-0"
                                placeholder="Search"
                                allowClear
                                onChange={(e) => setSearchTerm(e.target.value)}
                            />
                            <Radio.Group
                                defaultValue={evaluatorsDisplay}
                                onChange={(e) => setEvaluatorsDisplay(e.target.value)}
                                className="shrink-0"
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
                    <EvaluatorList
                        evaluatorConfigs={filteredEvaluators}
                        setEditMode={setEditMode}
                        setCurrent={setCurrent}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setEditEvalEditValues={setEditEvalEditValues}
                        onSuccess={onSuccess}
                        setCloneConfig={setCloneConfig}
                    />
                ) : (
                    <EvaluatorCard
                        evaluatorConfigs={filteredEvaluators}
                        setEditMode={setEditMode}
                        setCurrent={setCurrent}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setEditEvalEditValues={setEditEvalEditValues}
                        onSuccess={onSuccess}
                        setCloneConfig={setCloneConfig}
                    />
                )}
            </Spin>
        </div>
    )
}

export default Evaluators

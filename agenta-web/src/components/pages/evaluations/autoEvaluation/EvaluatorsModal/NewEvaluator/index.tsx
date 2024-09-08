import {Evaluator, JSSTheme} from "@/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {ArrowLeft, Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Flex, Input, Radio, Space, Typography} from "antd"
import React, {useMemo, useState} from "react"
import {createUseStyles} from "react-jss"
import NewEvaluatorList from "./NewEvaluatorList"
import NewEvaluatorCard from "./NewEvaluatorCard"

type NewEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    evaluators: Evaluator[]
    setSelectedEvaluator: React.Dispatch<React.SetStateAction<Evaluator | null>>
    setEvaluatorsDisplay: any
    evaluatorsDisplay: string
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& .ant-typography": {
            fontSize: theme.fontSizeHeading4,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
        },
    },
    subTitle: {
        fontSize: theme.fontSizeLG,
        lineHeight: theme.lineHeightLG,
        fontWeight: theme.fontWeightMedium,
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

const NewEvaluator = ({
    evaluators,
    setCurrent,
    handleOnCancel,
    setSelectedEvaluator,
    setEvaluatorsDisplay,
    evaluatorsDisplay,
}: NewEvaluatorProps) => {
    const classes = useStyles()
    const [searchTerm, setSearchTerm] = useState("")
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    const filteredEvaluators = useMemo(() => {
        if (!searchTerm) return evaluators
        return evaluators.filter((item) =>
            item.name.toLowerCase().includes(searchTerm.toLowerCase()),
        )
    }, [searchTerm, evaluators])

    return (
        <div>
            <div className="flex flex-col gap-4">
                <div className={classes.title}>
                    <Space>
                        {evaluatorsDisplay === "list" ? (
                            <Typography.Text>Configure evaluators</Typography.Text>
                        ) : (
                            <>
                                <Button
                                    icon={<ArrowLeft size={14} />}
                                    className="flex items-center justify-center"
                                    onClick={() => setCurrent(0)}
                                />
                                <Typography.Text>Step 1/2: Select new evaluator</Typography.Text>
                            </>
                        )}
                    </Space>

                    <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
                </div>
                <div>
                    <div className="flex items-center justify-between">
                        {evaluatorsDisplay === "list" ? (
                            <Space>
                                <Button
                                    icon={<ArrowLeft size={14} />}
                                    className="flex items-center justify-center"
                                    onClick={() => setCurrent(0)}
                                />
                                <Typography.Text className={classes.subTitle}>
                                    Create new evaluator
                                </Typography.Text>
                            </Space>
                        ) : (
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
                        )}
                        <Flex gap={8}>
                            <Input.Search
                                style={{width: 400}}
                                onChange={(e) => setSearchTerm(e.target.value)}
                                placeholder="Search"
                                allowClear
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
                </div>
                {evaluatorsDisplay !== "list" ? <Divider className="mt-2 mb-4" /> : <div />}
            </div>

            <div>
                {evaluatorsDisplay === "list" ? (
                    <NewEvaluatorList
                        evaluators={filteredEvaluators}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setCurrent={setCurrent}
                    />
                ) : (
                    <NewEvaluatorCard
                        evaluators={filteredEvaluators}
                        setSelectedEvaluator={setSelectedEvaluator}
                        setCurrent={setCurrent}
                    />
                )}
            </div>
        </div>
    )
}

export default NewEvaluator

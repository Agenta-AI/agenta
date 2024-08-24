import {Evaluator, JSSTheme} from "@/lib/Types"
import {CloseOutlined} from "@ant-design/icons"
import {ArrowLeft, Cards, Table} from "@phosphor-icons/react"
import {Button, Divider, Input, Radio, Space, Typography} from "antd"
import React, {useState} from "react"
import {createUseStyles} from "react-jss"

type CreateNewEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    handleOnCancel: () => void
    evaluators: Evaluator[]
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    title: {
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        "& h1": {
            fontSize: theme.fontSizeHeading5,
            fontWeight: theme.fontWeightStrong,
            lineHeight: theme.lineHeightLG,
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

const CreateNewEvaluator = ({evaluators, setCurrent, handleOnCancel}: CreateNewEvaluatorProps) => {
    const classes = useStyles()
    const [evaluatorsDisplay, setEvaluatorsDisplay] = useState("card")
    const [selectedEvaluatorCategory, setSelectedEvaluatorCategory] = useState("view_all")

    return (
        <div>
            <div className="flex flex-col gap-4">
                <div className={classes.title}>
                    <Space>
                        <Button
                            icon={<ArrowLeft size={14} />}
                            className="flex items-center justify-center"
                            onClick={() => setCurrent(0)}
                        />
                        <Typography.Title>Step 1/2: Select new evaluator</Typography.Title>
                    </Space>

                    <Button onClick={handleOnCancel} type="text" icon={<CloseOutlined />} />
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
                </div>
                <Divider className="mt-2 mb-4" />
            </div>
            <div>body</div>
        </div>
    )
}

export default CreateNewEvaluator

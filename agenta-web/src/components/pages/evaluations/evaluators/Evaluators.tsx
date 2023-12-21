import React, {useState} from "react"
import {createUseStyles} from "react-jss"
import Mock from "../evaluationResults/mock"
import EvaluatorCard from "./EvaluatorCard"
import {Button, Space} from "antd"
import {PlusCircleOutlined} from "@ant-design/icons"
import {pickRandom} from "@/lib/helpers/utils"
import {EvaluatorConfig} from "@/lib/Types"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        flexDirection: "column",
        gap: "1rem",
    },
    buttonsGroup: {
        alignSelf: "flex-end",
    },
    grid: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: "1rem",
    },
})

interface Props {}

const Evaluators: React.FC<Props> = () => {
    const classes = useStyles()
    const [evaluatorConfigs, setEvaluatorConfigs] = useState<EvaluatorConfig[]>(
        pickRandom(Mock.evaluators, 7).map((item, ix) => ({
            evaluator_key: item.key,
            id: ix + "",
            name: `Evaluator ${ix}`,
            settings_values: {},
            created_at: new Date().toString(),
        })),
    )

    return (
        <div className={classes.root}>
            <Space className={classes.buttonsGroup}>
                <Button icon={<PlusCircleOutlined />} type="primary">
                    New Evaluator
                </Button>
            </Space>
            <div className={classes.grid}>
                {evaluatorConfigs.map((item) => (
                    <EvaluatorCard key={item.id} evaluatorConfig={item} />
                ))}
            </div>
        </div>
    )
}

export default Evaluators

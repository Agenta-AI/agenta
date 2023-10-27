import {EvaluationScenario} from "@/lib/Types"
import {Input, Typography} from "antd"
import React from "react"
import {createUseStyles} from "react-jss"

const useStyles = createUseStyles({
    root: {
        display: "flex",
        gap: "1rem",
        flexWrap: "wrap",
    },
    inputRow: {
        display: "flex",
        flexDirection: "column",
        gap: "0.25rem",
        "& .ant-typography": {
            textTransform: "capitalize",
        },
        "& input": {
            width: 200,
        },
    },
})

interface Props {
    evaluationScenario: EvaluationScenario
    onInputChange: Function
}

const EvaluationInputs: React.FC<Props> = ({evaluationScenario, onInputChange}) => {
    const classes = useStyles()

    return (
        <div className={classes.root} key={evaluationScenario.id}>
            {evaluationScenario.inputs.map((ip, ix) => (
                <div key={ip.input_name} className={classes.inputRow}>
                    <Typography.Text>{ip.input_name}:</Typography.Text>
                    <Input
                        placeholder={ip.input_name}
                        defaultValue={ip.input_value}
                        onChange={(e) => onInputChange(e, evaluationScenario.id, ix)}
                    />
                </div>
            ))}
        </div>
    )
}

export default EvaluationInputs

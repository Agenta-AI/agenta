import {Button} from "antd"
import React from "react"

type ConfigureNewEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
}

const ConfigureNewEvaluator = ({setCurrent}: ConfigureNewEvaluatorProps) => {
    return (
        <div>
            ConfigureNewEvaluator <Button onClick={() => setCurrent(1)}>Back</Button>
        </div>
    )
}

export default ConfigureNewEvaluator

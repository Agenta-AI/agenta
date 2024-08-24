import {Button} from "antd"
import React from "react"

type CreateNewEvaluatorProps = {
    setCurrent: React.Dispatch<React.SetStateAction<number>>
}

const CreateNewEvaluator = ({setCurrent}: CreateNewEvaluatorProps) => {
    return (
        <div>
            CreateNewEvaluator <Button onClick={() => setCurrent(0)}>Back</Button>
            <Button onClick={() => setCurrent(2)}>Next</Button>
        </div>
    )
}

export default CreateNewEvaluator

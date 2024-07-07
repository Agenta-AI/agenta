import {Button, Typography} from "antd"
import React from "react"

interface EvaluationErrorTextProps {
    text: string
    setIsErrorModalOpen: (value: React.SetStateAction<boolean>) => void
}

const EvaluationErrorText = ({text, setIsErrorModalOpen}: EvaluationErrorTextProps) => {
    return (
        <Typography.Text type={"danger"} strong>
            {text}{" "}
            <Button
                size="small"
                className="text-xs"
                type="text"
                onClick={() => setIsErrorModalOpen(true)}
            >
                (more details)
            </Button>
        </Typography.Text>
    )
}

export default EvaluationErrorText

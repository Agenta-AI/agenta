import {Button, Typography} from "antd"

interface EvaluationErrorTextProps {
    text: string
    handleOnClick: () => void
}

const EvaluationErrorText = ({text, handleOnClick}: EvaluationErrorTextProps) => {
    return (
        <Typography.Text type={"danger"}>
            {text}{" "}
            <Button size="small" className="text-xs" type="text" onClick={() => handleOnClick()}>
                (more details)
            </Button>
        </Typography.Text>
    )
}

export default EvaluationErrorText

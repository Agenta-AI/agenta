import {Typography} from "antd"
import {GenerationOutputTextProps} from "./types"

const GenerationOutputText: React.FC<GenerationOutputTextProps> = ({text, type, ...props}) => {
    return (
        <Typography.Text type={type} {...props}>
            {text}
        </Typography.Text>
    )
}

export default GenerationOutputText

import {Typography} from "antd"
import {PlaygroundGenerationOutputTextProps} from "./types"

const {Text} = Typography

const PlaygroundGenerationOutputText: React.FC<PlaygroundGenerationOutputTextProps> = ({
    isOutput,
    text,
    ...props
}) => {
    if (isOutput === "error") {
        return (
            <Text type="danger" {...props}>
                {text}
            </Text>
        )
    }

    if (isOutput === "success") {
        return (
            <Text type="success" {...props}>
                {text}
            </Text>
        )
    }

    if (isOutput === "stale") {
        return (
            <Text type="secondary" {...props}>
                {text}
            </Text>
        )
    }

    return (
        <Text type="secondary" {...props}>
            Click to generate output
        </Text>
    )
}

export default PlaygroundGenerationOutputText

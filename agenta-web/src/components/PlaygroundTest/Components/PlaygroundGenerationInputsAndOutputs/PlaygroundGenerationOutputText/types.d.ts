import {Typography} from "antd"

const {Text} = Typography

export interface PlaygroundGenerationOutputTextProps extends React.ComponentProps<typeof Text> {
    isOutput: "error" | "success" | "stale" | "default"
    text: string
}

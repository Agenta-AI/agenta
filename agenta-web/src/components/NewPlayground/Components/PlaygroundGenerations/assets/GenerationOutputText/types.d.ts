import {Typography} from "antd"

const {Text} = Typography

export interface GenerationOutputTextProps extends React.ComponentProps<typeof Text> {
    text: string
}

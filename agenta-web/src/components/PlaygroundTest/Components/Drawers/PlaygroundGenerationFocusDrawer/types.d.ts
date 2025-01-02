import {DrawerProps} from "antd"

export interface PlaygroundGenerationFocusDrawerProps extends DrawerProps {
    type: "completion" | "chat"
}

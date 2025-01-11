import {DrawerProps} from "antd"

export interface GenerationFocusDrawerProps extends DrawerProps {
    type: "completion" | "chat"
    variantId: string
}

import {DrawerProps} from "antd"

export interface Props extends DrawerProps {
    type: 'completion' | "chat"
}
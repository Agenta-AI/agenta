import {ModalProps} from "antd"

export interface PlaygroundLoadTestsetModalProps extends ModalProps {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
    testsetData: Record<string, any> | null
}

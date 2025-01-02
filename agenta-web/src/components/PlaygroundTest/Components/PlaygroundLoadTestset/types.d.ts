import {Modal} from "antd"

export type Props = {
    setTestsetData: React.Dispatch<React.SetStateAction<Record<string, any> | null>>
    testsetData: Record<string, any> | null
} & React.ComponentProps<typeof Modal>

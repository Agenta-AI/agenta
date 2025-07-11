import {type UploadFile} from "antd"

export interface PromptImageUploadProps {
    disabled?: boolean
    handleUploadFileChange: (file: UploadFile | null) => void
    handleRemoveUploadFile: () => void
    imageFile?: UploadFile
}

import {SelectProps} from "antd"

export interface SelectLLMProviderProps extends SelectProps {
    showAddProvider?: boolean
    showGroup?: boolean
    showSearch?: boolean
    showCustomSecretsOnOptions?: boolean
    onAddProviderClick?: () => void
}

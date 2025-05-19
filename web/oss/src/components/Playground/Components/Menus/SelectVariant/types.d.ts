import {TreeSelectProps} from "antd"

export interface SelectVariantProps extends TreeSelectProps {
    showAsCompare?: boolean
}

export interface TreeSelectItemRendererProps {
    isOpen: boolean
    menu: any
    close: () => void
    showAsCompare?: boolean
    searchTerm: string
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>
}
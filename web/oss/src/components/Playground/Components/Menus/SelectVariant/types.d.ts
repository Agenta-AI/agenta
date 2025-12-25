import {TreeSelectProps} from "antd"

export interface SelectVariantProps extends TreeSelectProps {
    showAsCompare?: boolean
    showCreateNew?: boolean
    showLatestTag?: boolean
}

export interface TreeSelectItemRendererProps {
    isOpen: boolean
    menu: any
    close: () => void
    showAsCompare?: boolean
    showCreateNew?: boolean
    searchTerm: string
    setSearchTerm: React.Dispatch<React.SetStateAction<string>>
}

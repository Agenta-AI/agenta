import {DropDownProps} from "antd"

export interface PlaygroundVariantHeaderMenuProps extends DropDownProps {
    setIsVariantRenameOpen: (open: boolean) => void
    setIsResetModalOpen: (open: boolean) => void
    setIsDeleteVariantModalOpen: (open: boolean) => void
}

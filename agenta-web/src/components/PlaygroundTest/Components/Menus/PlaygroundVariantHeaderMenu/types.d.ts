import {DropDownProps} from "antd"

export interface PlaygroundVariantHeaderMenuProps extends DropDownProps {
    setIsFocusMoodOpen: (open: boolean) => void
    setIsVariantRenameOpen: (open: boolean) => void
    setIsResetModalOpen: (open: boolean) => void
    setIsCommitModalOpen: (open: boolean) => void
    setIsDeployOpen: (open: boolean) => void
    setIsDeleteVariantModalOpen: (open: boolean) => void
}

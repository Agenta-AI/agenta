import type {Environment, JSSTheme, Variant} from "@/lib/Types"
import type {DrawerProps} from "antd"

export interface VariantDrawerProps extends React.ComponentProps<typeof Drawer> {
    selectedVariant: Variant
    environments: Environment[]
    setIsDeleteEvalModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    setIsDeployVariantModalOpen: React.Dispatch<React.SetStateAction<boolean>>
    onClose?: (arg: any) => void
}

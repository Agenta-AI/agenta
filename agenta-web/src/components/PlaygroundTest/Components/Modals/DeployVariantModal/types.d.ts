import {Environment, Variant} from "@/lib/Types"
import {ModalProps} from "antd"

export interface DeployVariantModalProps extends ModalProps {
    variant: Variant
    environments: Environment[]
}

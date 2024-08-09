import {Variant} from "@/lib/Types"
import {Modal} from "antd"
import React from "react"

type ChangeVariantModalProps = {
    variants: Variant[]
} & React.ComponentProps<typeof Modal>

const ChangeVariantModal = ({...props}: ChangeVariantModalProps) => {
    return <Modal width={520} centered destroyOnClose footer={null} {...props}></Modal>
}

export default ChangeVariantModal

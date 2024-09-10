import {Variant} from "@/lib/Types"
import {Modal} from "antd"
import React from "react"
import {DiffEditor} from "@monaco-editor/react"

type VariantComparisonModalProps = {
    compareVariantList: Variant[]
} & React.ComponentProps<typeof Modal>

const VariantComparisonModal = ({compareVariantList, ...props}: VariantComparisonModalProps) => {
    return (
        <Modal centered width={1200} footer={null} {...props}>
            <DiffEditor
                language="json"
                original={JSON.stringify(compareVariantList[0].parameters, null, 2)}
                modified={JSON.stringify(compareVariantList[1].parameters, null, 2)}
                height="50vh"
            />
        </Modal>
    )
}

export default VariantComparisonModal

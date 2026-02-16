import {memo} from "react"

import dynamic from "next/dynamic"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"

import {SelectEvaluatorModalProps} from "./types"
const SelectEvaluatorModalContent = dynamic(() => import("./assets/SelectEvaluatorModalContent"), {
    ssr: false,
})

const SelectEvaluatorModal = ({open, onCancel, ...modalProps}: SelectEvaluatorModalProps) => {
    return (
        <EnhancedModal
            open={open}
            onCancel={onCancel}
            footer={null}
            width={520}
            className="[&_.ant-modal-content]:!rounded-xl [&_.ant-modal-content]:!p-0"
            classNames={{body: "!px-0"}}
            {...modalProps}
        >
            <SelectEvaluatorModalContent />
        </EnhancedModal>
    )
}

export default memo(SelectEvaluatorModal)

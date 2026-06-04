import {ModalProps} from "antd"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {TestsetCreationMode} from "@/oss/lib/Types"
import type {TestsetTableRow} from "@/oss/state/entities/testset"

import CreateTestset from "./CreateTestset"
import CreateTestsetFromApi from "./CreateTestsetFromApi"
import CreateTestsetFromScratch from "./CreateTestsetFromScratch"

const modalClass =
    "transition-[width] duration-300 ease-[ease] [&_.ant-modal-content]:overflow-hidden [&_.ant-modal-content]:rounded-2xl [&_.ant-modal-content>.ant-modal-close]:top-4"

interface Props extends ModalProps {
    testsetCreationMode: TestsetCreationMode
    setTestsetCreationMode: React.Dispatch<React.SetStateAction<TestsetCreationMode>>
    editTestsetValues: TestsetTableRow | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<TestsetTableRow | null>>
    current: number
    setCurrent: React.Dispatch<React.SetStateAction<number>>
}

const TestsetModal: React.FC<Props> = ({
    testsetCreationMode,
    setTestsetCreationMode,
    editTestsetValues,
    setEditTestsetValues,
    current,
    setCurrent,
    ...props
}) => {
    const onCancel = () => props.onCancel?.({} as any)

    const onCloseModal = () => {
        setTestsetCreationMode("create")
        setEditTestsetValues(null)
        setCurrent(0)
    }

    const steps = [
        {
            content: <CreateTestset setCurrent={setCurrent} onCancel={onCancel} />,
        },
        {
            content: (
                <CreateTestsetFromScratch
                    mode={testsetCreationMode}
                    setMode={setTestsetCreationMode}
                    setCurrent={setCurrent}
                    onCancel={onCancel}
                    editTestsetValues={editTestsetValues}
                    setEditTestsetValues={setEditTestsetValues}
                />
            ),
        },
        {
            content: <CreateTestsetFromApi setCurrent={setCurrent} onCancel={onCancel} />,
        },
    ]

    return (
        <EnhancedModal
            footer={null}
            title={null}
            width={480}
            afterClose={onCloseModal}
            className={modalClass}
            {...props}
        >
            {steps[current]?.content}
        </EnhancedModal>
    )
}

export default TestsetModal

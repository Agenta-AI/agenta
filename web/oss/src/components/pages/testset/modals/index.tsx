import {ModalProps} from "antd"
import {createUseStyles} from "react-jss"

import EnhancedModal from "@/oss/components/EnhancedUIs/Modal"
import {testset, TestsetCreationMode} from "@/oss/lib/Types"

import CreateTestset from "./CreateTestset"
import CreateTestsetFromApi from "./CreateTestsetFromApi"
import CreateTestsetFromScratch from "./CreateTestsetFromScratch"

const useStyles = createUseStyles({
    modal: {
        transition: "width 0.3s ease",
        "& .ant-modal-content": {
            overflow: "hidden",
            borderRadius: 16,
            "& > .ant-modal-close": {
                top: 16,
            },
        },
    },
})

interface Props extends ModalProps {
    testsetCreationMode: TestsetCreationMode
    setTestsetCreationMode: React.Dispatch<React.SetStateAction<TestsetCreationMode>>
    editTestsetValues: testset | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<testset | null>>
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
    const classes = useStyles()

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
            className={classes.modal}
            {...props}
        >
            {steps[current]?.content}
        </EnhancedModal>
    )
}

export default TestsetModal

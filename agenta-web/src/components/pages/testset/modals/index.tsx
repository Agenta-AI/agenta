import React from "react"
import {JSSTheme, testset, TestsetCreationMode} from "@/lib/Types"
import {Modal} from "antd"
import {createUseStyles} from "react-jss"
import CreateTestset from "./CreateTestset"
import CreateTestsetFromScratch from "./CreateTestsetFromScratch"
import UploadTestset from "./UploadTestset"
import CreateTestsetFromApi from "./CreateTestsetFromApi"

const useStyles = createUseStyles((theme: JSSTheme) => ({
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
}))

type Props = {
    testsetCreationMode: TestsetCreationMode
    setTestsetCreationMode: React.Dispatch<React.SetStateAction<TestsetCreationMode>>
    editTestsetValues: testset | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<testset | null>>
    current: number
    setCurrent: React.Dispatch<React.SetStateAction<number>>
} & React.ComponentProps<typeof Modal>

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
            content: <CreateTestset setCurrent={setCurrent} />,
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
            content: <UploadTestset setCurrent={setCurrent} onCancel={onCancel} />,
        },
        {
            content: <CreateTestsetFromApi setCurrent={setCurrent} onCancel={onCancel} />,
        },
    ]

    return (
        <Modal
            afterClose={onCloseModal}
            footer={null}
            title={null}
            className={classes.modal}
            {...props}
            width={480}
            centered
            destroyOnClose
        >
            {steps[current]?.content}
        </Modal>
    )
}

export default TestsetModal

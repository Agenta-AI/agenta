import React, {useState} from "react"
import {JSSTheme} from "@/lib/Types"
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

type Props = React.ComponentProps<typeof Modal> & {}

const TestsetModal: React.FC<Props> = ({...props}) => {
    const classes = useStyles()
    const [current, setCurrent] = useState(0)

    const onCancel = () => props.onCancel?.({} as any)

    const steps = [
        {
            content: <CreateTestset setCurrent={setCurrent} />,
        },
        {
            content: <CreateTestsetFromScratch setCurrent={setCurrent} onCancel={onCancel} />,
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
            afterClose={() => setCurrent(0)}
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

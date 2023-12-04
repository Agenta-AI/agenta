import React, {useState} from "react"
import {Modal} from "antd"
import {ExclamationCircleOutlined} from "@ant-design/icons"
import {createUseStyles} from "react-jss"
import {deleteTestsets, convertTestsetsToDummyIfInUse} from "@/lib/services/api"

const useStyles = createUseStyles({
    modalContainer: {
        display: "flex",
        flexDirection: "row",
        alignItems: "center",
    },
    modalIcon: {
        fontSize: "24px",
        color: "#faad14",
        marginRight: "10px",
    },
})

interface Props {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    testsetsIds: Array<string>
    mutate: () => void
    setSelectedRowKeys: (keys: React.Key[]) => void
}

const ConfirmTestsetDeleteModal: React.FC<Props> = ({
    isModalOpen,
    setIsModalOpen,
    testsetsIds,
    mutate,
    setSelectedRowKeys,
}) => {
    const classes = useStyles()
    const [isLoading, setIsLoading] = useState(false)
    const handleCloseModal = () => setIsModalOpen(false)
    const handleDismiss = () => handleCloseModal()
    const handleConfirmOK = async () => {
        setIsLoading(true)
        try {
            // make sure promise is completely fulfilled before deleting testsets
            await convertTestsetsToDummyIfInUse(testsetsIds).then(async () => {
                await deleteTestsets(testsetsIds)
                mutate()
                setSelectedRowKeys([])
                handleCloseModal()
            })
        } catch (err) {
            console.log("Something went wrong with converting/deleting testsets: ", err)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Modal
            title="Confirm Testset(s) Deletion"
            visible={isModalOpen}
            onOk={handleConfirmOK}
            onCancel={handleDismiss}
            centered
            confirmLoading={isLoading}
        >
            <div className={classes.modalContainer}>
                <ExclamationCircleOutlined className={classes.modalIcon} />
                <p data-cy="testset-name-reqd-error">
                    Deleting these testset(s) will change the evaluation in use of it/them to use a
                    dummy testset. Are you sure you want to proceed?
                </p>
            </div>
        </Modal>
    )
}

export default ConfirmTestsetDeleteModal

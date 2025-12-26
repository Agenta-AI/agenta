import {Dispatch, SetStateAction, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {Modal, ModalProps} from "antd"
import {KeyedMutator} from "swr"

import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {testset} from "@/oss/lib/Types"
import {deleteTestsets} from "@/oss/services/testsets/api"

interface DeleteTestsetProps extends ModalProps {
    selectedTestsetToDelete: testset[]
    mutate: KeyedMutator<any>
    setSelectedTestsetToDelete: Dispatch<SetStateAction<testset[]>>
}

const DeleteTestset = ({
    selectedTestsetToDelete,
    mutate,
    setSelectedTestsetToDelete,
    ...props
}: DeleteTestsetProps) => {
    const [isLoading, setIsLoading] = useState(false)

    const onDelete = async () => {
        const testsetsIds = selectedTestsetToDelete
            .map((testset) => ((testset as any)._id ?? (testset as any).id)?.toString())
            .filter(Boolean) as string[]

        try {
            setIsLoading(true)
            if (
                !(await checkIfResourceValidForDeletion({
                    resourceType: "testset",
                    resourceIds: testsetsIds,
                }))
            )
                return
            await deleteTestsets(testsetsIds)
            mutate()
            setSelectedTestsetToDelete([])
            props.onCancel?.({} as any)
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    return (
        <Modal
            destroyOnHidden
            title="Are you sure?"
            okText="Delete"
            okButtonProps={{danger: true, icon: <DeleteOutlined />, loading: isLoading}}
            centered
            cancelText="Cancel"
            onOk={onDelete}
            {...props}
        >
            <p>
                Are you sure you want to delete{" "}
                <span className="font-[500]">
                    {selectedTestsetToDelete.map((testset) => testset.name).join(", ")}
                </span>
                ?
            </p>
        </Modal>
    )
}

export default DeleteTestset

import {Dispatch, SetStateAction, useState} from "react"

import {DeleteOutlined} from "@ant-design/icons"
import {Modal} from "antd"
import {KeyedMutator} from "swr"

import {checkIfResourceValidForDeletion} from "@/oss/lib/helpers/evaluate"
import {testset} from "@/oss/lib/Types"
import {deleteTestsets} from "@/oss/services/testsets/api"

type DeleteTestsetProps = {
    selectedTestsetToDelete: testset[]
    mutate: KeyedMutator<any>
    setSelectedTestsetToDelete: Dispatch<SetStateAction<testset[]>>
} & React.ComponentProps<typeof Modal>

const DeleteTestset = ({
    selectedTestsetToDelete,
    mutate,
    setSelectedTestsetToDelete,
    ...props
}: DeleteTestsetProps) => {
    const [isLoading, setIsLoading] = useState(false)

    const onDelete = async () => {
        const testsetsIds = selectedTestsetToDelete.map((testset) => testset._id.toString())

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

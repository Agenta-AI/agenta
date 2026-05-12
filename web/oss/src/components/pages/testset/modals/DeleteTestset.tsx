import {Dispatch, SetStateAction, useMemo, useState} from "react"

import {testsetMolecule} from "@agenta/entities/testset"
import {ArchiveIcon} from "@phosphor-icons/react"
import {message, Modal, ModalProps} from "antd"
import {KeyedMutator} from "swr"

import {checkIfResourceValidForDeletion} from "@/oss/lib/evaluations/legacy"
import {testset} from "@/oss/lib/Types"
import {archiveTestsetRevision} from "@/oss/services/testsets/api"
import {getProjectValues} from "@/oss/state/project"

interface DeleteTestsetProps extends ModalProps {
    selectedTestsetToDelete: testset[]
    mutate: KeyedMutator<any>
    setSelectedTestsetToDelete: Dispatch<SetStateAction<testset[]>>
    /** Called after successful deletion with the deleted items */
    onAfterDelete?: (deleted: {testsets: testset[]; revisions: testset[]}) => void
}

const DeleteTestset = ({
    selectedTestsetToDelete,
    mutate,
    setSelectedTestsetToDelete,
    onAfterDelete,
    ...props
}: DeleteTestsetProps) => {
    const [isLoading, setIsLoading] = useState(false)

    // Separate testsets from revisions
    const {testsets, revisions} = useMemo(() => {
        const testsets: testset[] = []
        const revisions: testset[] = []

        for (const item of selectedTestsetToDelete) {
            if ((item as any).__isRevision) {
                revisions.push(item)
            } else {
                testsets.push(item)
            }
        }

        return {testsets, revisions}
    }, [selectedTestsetToDelete])

    const onDelete = async () => {
        try {
            setIsLoading(true)

            // Delete testsets (this archives the testset and all its revisions)
            if (testsets.length > 0) {
                const testsetsIds = testsets
                    .map((testset) => ((testset as any)._id ?? (testset as any).id)?.toString())
                    .filter(Boolean) as string[]

                if (
                    !(await checkIfResourceValidForDeletion({
                        resourceType: "testset",
                        resourceIds: testsetsIds,
                    }))
                )
                    return

                const {projectId} = getProjectValues()
                await testsetMolecule.lifecycle.archive(testsetsIds, {projectId})
            }

            // Delete individual revisions
            if (revisions.length > 0) {
                const revisionIds = revisions
                    .map((r) => ((r as any)._id ?? (r as any).id)?.toString())
                    .filter(Boolean) as string[]

                await Promise.all(revisionIds.map((id) => archiveTestsetRevision(id)))
            }

            mutate()
            onAfterDelete?.({testsets, revisions})
            setSelectedTestsetToDelete([])
            props.onCancel?.({} as any)

            const archivedCount = testsets.length + revisions.length
            const archiveLabel =
                testsets.length > 0 && revisions.length > 0
                    ? "items"
                    : revisions.length > 0
                      ? "revisions"
                      : "testsets"

            message.success(
                archivedCount === 1
                    ? archiveLabel === "revisions"
                        ? "Revision archived"
                        : "Testset archived"
                    : `${archivedCount} ${archiveLabel} archived`,
            )
        } catch (error) {
            console.error(error)
        } finally {
            setIsLoading(false)
        }
    }

    // Build descriptive content with grouped items
    const renderContent = () => {
        return (
            <div className="flex flex-col gap-3">
                <p className="m-0">Are you sure you want to archive the following?</p>

                {testsets.length > 0 && (
                    <div>
                        <p className="m-0 text-gray-500 text-xs uppercase tracking-wide mb-1">
                            Testsets (including all revisions)
                        </p>
                        <ul className="m-0 pl-5">
                            {testsets.map((t) => (
                                <li key={t.id} className="font-medium">
                                    {t.name}
                                </li>
                            ))}
                        </ul>
                    </div>
                )}

                {revisions.length > 0 && (
                    <div>
                        <p className="m-0 text-gray-500 text-xs uppercase tracking-wide mb-1">
                            Revisions only
                        </p>
                        <ul className="m-0 pl-5">
                            {revisions.map((r) => {
                                const version = (r as any).__version
                                return (
                                    <li key={r.id} className="font-medium">
                                        {r.name}
                                        {version !== undefined && (
                                            <span className="text-gray-500 font-normal ml-1">
                                                v{version}
                                            </span>
                                        )}
                                    </li>
                                )
                            })}
                        </ul>
                    </div>
                )}
            </div>
        )
    }

    return (
        <Modal
            destroyOnHidden
            title="Are you sure?"
            okText="Archive"
            okButtonProps={{danger: true, icon: <ArchiveIcon size={14} />, loading: isLoading}}
            centered
            cancelText="Cancel"
            onOk={onDelete}
            {...props}
        >
            {renderContent()}
        </Modal>
    )
}

export default DeleteTestset

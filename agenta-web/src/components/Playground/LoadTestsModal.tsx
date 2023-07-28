import { loadDataset, useLoadDatasetsList } from "@/lib/services/api"
import { Button, Divider, Dropdown, Modal, Select } from "antd"
import { useRouter } from "next/router"
import { PropsWithChildren, useState } from "react"

interface Props extends PropsWithChildren {
    addNewTests: (tests: Record<string, string>[]) => void
    setNewTests: (tests: Record<string, string>[]) => void
}

const LoadTestsModal: React.FC<Props> = (props) => {
    const { addNewTests, setNewTests } = props
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [selectedSet, setSelectedSet] = useState<string>("")

    const appName = router.query.app_name?.toString() || ""

    const { datasets, isDatasetsLoading, isDatasetsLoadingError } = useLoadDatasetsList(appName)

    const options = datasets?.map((item: Record<string, any>) => ({
        label: item.name,
        value: item._id,
    }))

    const handleAddData = () => {
        loadDataset(selectedSet).then((data) => {
            addNewTests(data.csvdata)
        })
        setIsOpen(false)
    }

    const handleSetData = () => {
        loadDataset(selectedSet).then((data) => {
            setNewTests(data.csvdata)
        })
        setIsOpen(false)
    }

    return (
        <div>
            <Modal
                title="Load tests"
                open={isOpen}
                onCancel={() => setIsOpen(false)}
                footer={
                    <>
                        <Button disabled={!selectedSet} onClick={handleAddData}>
                            Add tests
                        </Button>
                        <Button disabled={!selectedSet} onClick={handleSetData}>
                            Replace tests
                        </Button>
                    </>
                }
            >
                <p style={{ marginBottom: 10 }}>Please select the test set you want to use:</p>

                <Select
                    style={{ minWidth: 120, marginBottom: 20 }}
                    options={options}
                    placeholder="Select data set"
                    onSelect={(id) => setSelectedSet(id)}
                />

                {selectedSet ? (
                    <>
                        <p>Click add test to add data to existing test</p>
                        <p>Click replace tests to replace data of existing tests</p>
                    </>
                ) : null}
                <Divider style={{ margin: "24px 0 0 0" }} />
            </Modal>

            <Button
                type="primary"
                size="middle"
                onClick={() => setIsOpen(true)}
                loading={isDatasetsLoading}
            >
                Load Test sets
            </Button>
        </div>
    )
}

export default LoadTestsModal

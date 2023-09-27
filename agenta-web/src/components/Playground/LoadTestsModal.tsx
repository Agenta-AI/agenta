import {loadTestset, useLoadTestsetsList} from "@/lib/services/api"
import {Button, Divider, Dropdown, Modal, Select, Space} from "antd"
import {useRouter} from "next/router"
import {PropsWithChildren, useState} from "react"
import {createUseStyles} from "react-jss"

interface Props extends PropsWithChildren {
    onLoad: (tests: Record<string, string>[], shouldReplace: boolean) => void
}

const useStyles = createUseStyles({
    p: {
        marginBottom: 10,
    },
    select: {
        minWidth: 120,
        marginBottom: 20,
    },
    divider: {
        margin: "24px 0 0 0",
    },
})

const LoadTestsModal: React.FC<Props> = (props) => {
    const classes = useStyles()
    const {onLoad} = props
    const router = useRouter()
    const [isOpen, setIsOpen] = useState(false)
    const [selectedSet, setSelectedSet] = useState<string>("")

    const appId = router.query.app_id as string

    const {testsets, isTestsetsLoading, isTestsetsLoadingError} = useLoadTestsetsList(appId)

    const options = testsets?.map((item: Record<string, any>) => ({
        label: item.name,
        value: item._id,
    }))

    const handleClick = (shouldReplace: boolean) => {
        loadTestset(selectedSet).then((data) => {
            onLoad(data.csvdata, shouldReplace)
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
                        <Button disabled={!selectedSet} onClick={() => handleClick(false)}>
                            Add tests
                        </Button>
                        <Button disabled={!selectedSet} onClick={() => handleClick(true)}>
                            Replace tests
                        </Button>
                    </>
                }
            >
                <p className={classes.p}>Please select the test set you want to use:</p>

                <Select
                    className={classes.select}
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
                <Divider className={classes.divider} />
            </Modal>

            <Button
                type="primary"
                size="middle"
                onClick={() => setIsOpen(true)}
                loading={isTestsetsLoading}
            >
                Load Test sets
            </Button>
        </div>
    )
}

export default LoadTestsModal

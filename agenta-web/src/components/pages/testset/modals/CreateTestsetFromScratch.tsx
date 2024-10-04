import React, {useState} from "react"
import {JSSTheme, KeyValuePair, testset} from "@/lib/Types"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Input, message, Typography} from "antd"
import {createUseStyles} from "react-jss"
import {useRouter} from "next/router"
import {
    createNewTestset,
    fetchTestset,
    updateTestset,
    useLoadTestsetsList,
} from "@/services/testsets/api"
import {fetchVariants} from "@/services/api"
import {getVariantInputParameters} from "@/lib/helpers/variantHelper"

const useStyles = createUseStyles((theme: JSSTheme) => ({
    headerText: {
        lineHeight: theme.lineHeightLG,
        fontSize: theme.fontSizeHeading4,
        fontWeight: theme.fontWeightStrong,
    },
    label: {
        fontWeight: theme.fontWeightMedium,
    },
}))

type Props = {
    cloneConfig: boolean
    setCloneConfig: React.Dispatch<React.SetStateAction<boolean>>
    editTestsetValues: testset | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<testset | null>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    renameTestsetConfig: boolean
    setRenameTestsetConfig: React.Dispatch<React.SetStateAction<boolean>>
    onCancel: () => void
}

const CreateTestsetFromScratch: React.FC<Props> = ({
    cloneConfig,
    setCloneConfig,
    editTestsetValues,
    setEditTestsetValues,
    renameTestsetConfig,
    setRenameTestsetConfig,
    setCurrent,
    onCancel,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const appId = router.query.app_id as string
    const [testsetName, setTestsetName] = useState(
        renameTestsetConfig ? (editTestsetValues?.name as string) : "",
    )
    const [isLoading, setIsLoading] = useState(false)
    const {mutate} = useLoadTestsetsList(appId)

    const handleCreateTestset = async () => {
        try {
            setIsLoading(true)

            const backendVariants = await fetchVariants(appId)
            const variant = backendVariants[0]
            const inputParams = await getVariantInputParameters(appId, variant)
            const colData = inputParams.map((param) => ({field: param.name}))
            colData.push({field: "correct_answer"})

            const initialRowData = Array(3).fill({})
            const separateRowData = initialRowData.map(() => {
                return colData.reduce((acc, curr) => ({...acc, [curr.field]: ""}), {})
            })

            const response = await createNewTestset(appId, testsetName, separateRowData)
            message.success("Test set created successfully")
            router.push(`/apps/${appId}/testsets/${response.data.id}`)
        } catch (error) {
            console.error("Error saving test set:", error)
            message.success("Failed to create Test set. Please try again!")
        } finally {
            setIsLoading(false)
        }
    }

    const handleCloneTestset = async () => {
        try {
            setIsLoading(true)

            const fetchTestsetValues = await fetchTestset(editTestsetValues?._id as string)

            if (fetchTestsetValues.csvdata) {
                const response = await createNewTestset(
                    appId,
                    testsetName,
                    fetchTestsetValues.csvdata,
                )
                message.success("Test set cloned successfully")
                router.push(`/apps/${appId}/testsets/${response.data.id}`)
            } else {
                message.error("Failed to load intances")
            }
        } catch (error) {
            message.error("Something went wrong. Please tru again later!")
        } finally {
            setIsLoading(false)
        }
    }

    const handleRenameTestset = async () => {
        try {
            setIsLoading(true)

            const fetchTestsetValues = await fetchTestset(editTestsetValues?._id as string)

            if (fetchTestsetValues.csvdata) {
                await updateTestset(
                    editTestsetValues?._id as string,
                    testsetName,
                    fetchTestsetValues.csvdata,
                )
                message.success("Test set renamed successfully")
                mutate()
                onCancel()
            } else {
                message.error("Failed to load intances")
            }
        } catch (error) {
            message.error("Something went wrong. Please tru again later!")
        } finally {
            setIsLoading(false)
        }
    }

    const backForward = () => {
        setCloneConfig(false)
        setEditTestsetValues(null)
        setCurrent(0)
        setRenameTestsetConfig(false)
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={backForward}
                />

                <Typography.Text className={classes.headerText}>
                    Create from scratch
                </Typography.Text>
            </div>

            <Typography.Text>Create a new test set directly from the webUI</Typography.Text>

            <div className="grid gap-1">
                <Typography.Text className={classes.label}>Name of testset</Typography.Text>
                <Input
                    placeholder="Enter a name"
                    value={testsetName}
                    onChange={(e) => setTestsetName(e.target.value)}
                    data-cy="testset-name-input"
                />
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button
                    type="primary"
                    disabled={!testsetName}
                    onClick={() => {
                        cloneConfig && handleCloneTestset()
                        renameTestsetConfig && handleRenameTestset()
                        !cloneConfig && !renameTestsetConfig ? handleCreateTestset() : null
                    }}
                    loading={isLoading}
                    data-cy="create-new-testset-button"
                >
                    Create test set
                </Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromScratch

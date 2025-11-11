import {useMemo, useState} from "react"

import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Input, message, Typography} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import useURL from "@/oss/hooks/useURL"
import {JSSTheme, KeyValuePair, testset, TestsetCreationMode} from "@/oss/lib/Types"
import {createNewTestset, fetchTestset, updateTestset} from "@/oss/services/testsets/api"
import {useTestsetsData} from "@/oss/state/testset"

const {Text} = Typography

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

interface Props {
    mode: TestsetCreationMode
    setMode: React.Dispatch<React.SetStateAction<TestsetCreationMode>>
    editTestsetValues: testset | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<testset | null>>
    setCurrent: React.Dispatch<React.SetStateAction<number>>
    onCancel: () => void
}

const CreateTestsetFromScratch: React.FC<Props> = ({
    mode,
    setMode,
    editTestsetValues,
    setEditTestsetValues,
    setCurrent,
    onCancel,
}) => {
    const classes = useStyles()
    const router = useRouter()
    const {projectURL} = useURL()
    const [testsetName, setTestsetName] = useState(
        mode === "rename" ? (editTestsetValues?.name as string) : "",
    )
    const [isLoading, setIsLoading] = useState(false)
    const {mutate} = useTestsetsData()

    const handleCreateTestset = async (data?: KeyValuePair[]) => {
        setIsLoading(true)
        try {
            const rowData = data
            const response = await createNewTestset(testsetName, rowData)

            await mutate()
            message.success("Test set created successfully")
            router.push(`${projectURL}/testsets/${response.data.id}`)
        } catch (error) {
            console.error("Error saving test set:", error)
            message.error("Failed to create Test set. Please try again!")
        } finally {
            setIsLoading(false)
        }
    }

    const handleCloneTestset = async (testsetId: string) => {
        setIsLoading(true)
        try {
            const fetchedTestset = await fetchTestset(testsetId)
            if (fetchedTestset.csvdata) {
                await handleCreateTestset(fetchedTestset.csvdata)
            } else {
                throw new Error("Failed to load instances")
            }
        } catch (error) {
            console.error("Error cloning test set:", error)
            message.error("Failed to clone Test set. Please try again!")
        } finally {
            setIsLoading(false)
        }
    }

    const handleRenameTestset = async (testsetId: string) => {
        setIsLoading(true)
        try {
            const fetchedTestset = await fetchTestset(testsetId)
            if (fetchedTestset.csvdata) {
                await updateTestset(testsetId, testsetName, fetchedTestset.csvdata)
                message.success("Test set renamed successfully")
                mutate()
                onCancel()
            } else {
                throw new Error("Failed to load instances")
            }
        } catch (error) {
            console.error("Error renaming test set:", error)
            message.error("Failed to rename Test set. Please try again!")
        } finally {
            setIsLoading(false)
        }
    }

    const onSubmit = () => {
        switch (mode) {
            case "create":
                handleCreateTestset()
                break
            case "clone":
                handleCloneTestset(editTestsetValues?._id as string)
                break
            case "rename":
                handleRenameTestset(editTestsetValues?._id as string)
                break
        }
    }

    const getHeaderText = useMemo(() => {
        switch (mode) {
            case "create":
                return "Create from scratch"
            case "clone":
                return "Clone Test set"
            case "rename":
                return "Rename Test set"
        }
    }, [mode])

    const goBackToInitialStep = () => {
        setMode("create")
        setEditTestsetValues(null)
        setCurrent(0)
    }

    return (
        <section className="grid gap-4">
            <div className="flex items-center gap-2 mb-1">
                <Button
                    icon={<ArrowLeft size={14} className="mt-0.5" />}
                    className="flex items-center justify-center"
                    onClick={goBackToInitialStep}
                />

                <Text className={classes.headerText}>{getHeaderText}</Text>
            </div>

            <Text>Create a new test set directly from the webUI</Text>

            <div className="grid gap-1">
                <Text className={classes.label}>Test Set Name</Text>
                <Input
                    placeholder="Enter a name"
                    value={testsetName}
                    onChange={(e) => setTestsetName(e.target.value)}
                />
            </div>

            <div className="flex justify-end gap-2 mt-3">
                <Button onClick={onCancel} disabled={isLoading}>
                    Cancel
                </Button>
                <Button
                    type="primary"
                    disabled={!testsetName}
                    onClick={onSubmit}
                    loading={isLoading}
                >
                    {mode === "rename" ? "Rename" : "Create test set"}
                </Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromScratch

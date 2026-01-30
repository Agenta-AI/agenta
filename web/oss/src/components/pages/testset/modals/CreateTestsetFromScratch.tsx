import {useMemo, useState} from "react"

import {message} from "@agenta/ui/app-message"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button, Input, Typography} from "antd"
import {useSetAtom} from "jotai"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {testsetsRefreshTriggerAtom} from "@/oss/components/TestsetsTable/atoms/tableStore"
import useURL from "@/oss/hooks/useURL"
import {recordWidgetEventAtom} from "@/oss/lib/onboarding"
import {JSSTheme, KeyValuePair, TestsetCreationMode} from "@/oss/lib/Types"
import {cloneTestset, renameTestset} from "@/oss/services/testsets/api"
import {invalidateTestsetsListCache, type TestsetTableRow} from "@/oss/state/entities/testset"

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
    editTestsetValues: TestsetTableRow | null
    setEditTestsetValues: React.Dispatch<React.SetStateAction<TestsetTableRow | null>>
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
    const setRefreshTrigger = useSetAtom(testsetsRefreshTriggerAtom)
    const recordWidgetEvent = useSetAtom(recordWidgetEventAtom)

    const handleCreateTestset = async (_data?: KeyValuePair[]) => {
        // Navigate to testset page with "new" as the ID and testset name as query param
        // The testset page will handle local state and save via simple API on commit
        const encodedName = encodeURIComponent(testsetName)
        router.push(`${projectURL}/testsets/new?name=${encodedName}`)
        onCancel()
    }

    const handleCloneTestset = async (testsetId: string) => {
        setIsLoading(true)
        try {
            const response = await cloneTestset(testsetId, testsetName)

            // Revalidate both legacy testsets data and the new table store
            invalidateTestsetsListCache()
            setRefreshTrigger((prev) => prev + 1)
            message.success("Testset cloned successfully")
            recordWidgetEvent("testset_created")

            // Navigate to the new revision
            const revisionId = response.data?.revisionId
            if (revisionId) {
                router.push(`${projectURL}/testsets/${revisionId}`)
            } else {
                const newTestsetId = response.data?.testset?.id
                if (newTestsetId) {
                    router.push(`${projectURL}/testsets/${newTestsetId}`)
                }
            }
            onCancel()
        } catch (error) {
            console.error("Error cloning testset:", error)
            message.error("Failed to clone Testset. Please try again!")
        } finally {
            setIsLoading(false)
        }
    }

    const handleRenameTestset = async (testsetId: string) => {
        setIsLoading(true)
        try {
            await renameTestset(testsetId, testsetName)
            message.success("Testset renamed successfully")
            invalidateTestsetsListCache()
            setRefreshTrigger((prev) => prev + 1)
            onCancel()
        } catch (error) {
            console.error("Error renaming testset:", error)
            message.error("Failed to rename Testset. Please try again!")
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
                handleCloneTestset(editTestsetValues?.id as string)
                break
            case "rename":
                handleRenameTestset(editTestsetValues?.id as string)
                break
        }
    }

    const getHeaderText = useMemo(() => {
        switch (mode) {
            case "create":
                return "Create from scratch"
            case "clone":
                return "Clone Testset"
            case "rename":
                return "Rename Testset"
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

            <Text>Create a new testset directly from the webUI</Text>

            <div className="grid gap-1">
                <Text className={classes.label}>Testset Name</Text>
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
                    {mode === "rename" ? "Rename" : "Create testset"}
                </Button>
            </div>
        </section>
    )
}

export default CreateTestsetFromScratch

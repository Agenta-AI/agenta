import {useCallback, type FC} from "react"

import {Typography, Button} from "antd"

// import {revisionListAtom} from "@/oss/state/variant/selectors/variant"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"
import {usePlaygroundStatus} from "./hooks/usePlaygroundStatus"

const {Title, Text} = Typography

const PlaygroundWrapper = () => {
    const {isLoading, error} = usePlaygroundStatus()

    // Map to legacy format for backward compatibility
    const uri = "playground" // Static value, no need for complex data subscription

    const refetch = useCallback(() => {
        // console.log("🔄 Playground: Triggering refetch via atom invalidation")
        // Atoms automatically refetch when dependencies change
        // No explicit refetch needed in atom-based system
    }, [])

    const handleReload = useCallback(() => {
        if (refetch) {
            refetch()
        }
    }, [refetch])

    // PROGRESSIVE LOADING: Show error state only for critical failures
    // Let individual components handle their own loading states
    if (error) {
        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                <div className="flex flex-col items-center justify-center gap-1">
                    <Title level={3}>Something went wrong</Title>
                    <Text className="mb-3 text-[14px]">{error?.message || String(error)}</Text>
                    <Button onClick={handleReload}>Try again</Button>
                </div>
            </main>
        )
    }

    // PROGRESSIVE LOADING: Always render playground shell
    // Components will handle their own loading/skeleton states
    return (
        <>
            <PlaygroundHeader key={`${uri}-header`} isLoading={isLoading} />
            <PlaygroundMainView key={`${uri}-main`} isLoading={isLoading} />
        </>
    )
}

const Playground: FC = () => {
    // Initialize unified playground hook for global state
    // Log which system is being used (development only)

    return (
        <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
            <PlaygroundWrapper />
        </div>
    )
}

export default Playground

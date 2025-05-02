import {useCallback, useEffect, useMemo, useRef, type FC, type JSX} from "react"

import {Typography} from "antd"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import usePlayground from "./hooks/usePlayground"

const Spin = dynamic(() => import("antd/lib/spin"), {ssr: false})
const Button = dynamic(() => import("antd/lib/button"), {ssr: false})
const PlaygroundMainView = dynamic(() => import("./Components/MainLayout"), {ssr: false})
const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})
const SWRDevTools = dynamic(() => import("swr-devtools").then((mod) => mod.SWRDevTools), {
    ssr: false,
})

const {Title, Text} = Typography
const PlaygroundWrapper = () => {
    const router = useRouter()
    // Use refs to track state for preventing infinite cycles
    const isUpdatingFromUrl = useRef(false)
    const prevDisplayedVariantsRef = useRef<string[]>([])

    const playgroundData = usePlayground({
        stateSelector: (state) => ({
            err: state.error,
            uri: state.uri,
            selected: state.selected,
        }),
    })

    const {err: error, isLoading, uri, selected, mutate, setDisplayedVariants} = playgroundData

    const routerRevisions = useMemo(() => {
        // Handle both string and array cases for revisions query parameter
        if (!router.query.revisions) return []

        // If it's a JSON string, parse it
        try {
            if (typeof router.query.revisions === "string") {
                return JSON.parse(router.query.revisions)
            }
        } catch (e) {
            console.error("Error parsing revisions from URL", e)
        }

        return []
    }, [router.query.revisions])

    const handleReload = useCallback(() => {
        mutate((data) => data, {
            revalidate: true,
        })
    }, [])

    // Effect to mount revisions from URL when the component loads
    useEffect(() => {
        console.log("PlaygroundWrapper useEffect - mounting from URL", {
            isLoading,
            routerRevisions,
            hasSetDisplayedVariants: !!setDisplayedVariants,
            currentDisplayed: selected,
        })

        if (isLoading || routerRevisions.length === 0 || !setDisplayedVariants) return

        // Check if the current displayed variants are exactly the same (including order)
        // as the ones from the URL to avoid unnecessary mutations
        if (selected && selected.length === routerRevisions.length) {
            // Compare arrays with exact order matching
            const exactMatch = selected.every((id, index) => id === routerRevisions[index])

            if (exactMatch) {
                console.log("Skipping mutation - variants already match exactly (including order)")
                return
            }
        }

        // Set flag to indicate we're updating from URL to prevent cycles
        isUpdatingFromUrl.current = true

        // Use the setDisplayedVariants function to properly mount the revisions
        // This will ensure the variants are added to both the selected array and the variants array
        console.log("Mounting revisions:", routerRevisions)
        setDisplayedVariants(routerRevisions)

        // Update the previous variants ref to match what we just set
        prevDisplayedVariantsRef.current = routerRevisions

        // Reset the flag after a short delay to allow the state to update
        setTimeout(() => {
            isUpdatingFromUrl.current = false
        }, 100)
    }, [routerRevisions, isLoading])

    // Effect to update URL when selected variants change
    useEffect(() => {
        console.log("UPDATE URI:", selected, isUpdatingFromUrl.current)
        // Skip if we're currently updating from URL or if data isn't loaded yet
        if (isUpdatingFromUrl.current || isLoading || !selected) {
            console.log("URL update skipped - initial conditions not met:", {
                isUpdatingFromUrl: isUpdatingFromUrl.current,
                isLoading,
                hasDisplayedVariants: !!selected,
            })
            return
        }

        const currentDisplayedVariants = selected.filter(Boolean)
        if (!currentDisplayedVariants.length) return

        // Skip if there are no displayed variants
        if (currentDisplayedVariants.length === 0) {
            console.log("URL update skipped - no displayed variants")
            return
        }

        // First check exact array equality (including order)
        if (routerRevisions.length === currentDisplayedVariants.length) {
            const exactMatch = currentDisplayedVariants.every(
                (id, index) => id === routerRevisions[index],
            )

            if (exactMatch) {
                console.log(
                    "URL update skipped - variants already match exactly (including order)",
                    {
                        currentDisplayedVariants,
                        routerRevisions,
                    },
                )
                return
            }
            console.log("URL update - exact match check failed despite same length")
        } else {
            console.log("URL update - arrays have different lengths", {
                currentLength: currentDisplayedVariants.length,
                routerLength: routerRevisions.length,
            })
        }

        // If not an exact match, check if the arrays contain the same elements (ignoring order)
        const sortedCurrent = [...currentDisplayedVariants].sort()
        const sortedRouter = [...routerRevisions].sort()
        const sortedPrev = [...prevDisplayedVariantsRef.current].sort()

        // Skip if the URL already matches or if there's no change from previous state
        const currentStr = JSON.stringify(sortedCurrent)
        const routerStr = JSON.stringify(sortedRouter)
        const prevStr = JSON.stringify(sortedPrev)

        console.log("URL update - comparing sorted arrays:", {
            currentStr,
            routerStr,
            prevStr,
            matchesRouter: currentStr === routerStr,
            matchesPrev: currentStr === prevStr,
        })

        if (currentStr === routerStr || currentStr === prevStr) {
            console.log("URL update skipped - arrays match when sorted")
            return
        }

        // Update the previous variants ref
        prevDisplayedVariantsRef.current = currentDisplayedVariants

        console.log("Updating URL with current revisions:", {
            currentDisplayedVariants,
            previousURL: router.asPath,
            newRevisions: JSON.stringify(currentDisplayedVariants),
        })

        // Update URL with current selection using shallow routing to avoid page reload
        router.push(
            {
                pathname: router.pathname,
                query: {
                    ...router.query,
                    revisions: JSON.stringify(currentDisplayedVariants),
                },
            },
            undefined,
            {shallow: true},
        )

        console.log("URL update completed")
    }, [isLoading, selected, router, routerRevisions])

    if (isLoading) {
        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                <div className="flex gap-2 items-center justify-center">
                    <Spin />
                    <Title level={3} className="!m-0">
                        Loading Playground...
                    </Title>
                </div>
            </main>
        )
    } else if (error) {
        return (
            <main className="flex flex-col grow h-full overflow-hidden items-center justify-center">
                <div className="flex flex-col items-center justify-center gap-1">
                    <Title level={3}>Something went wrong</Title>
                    <Text className="mb-3 text-[14px]">{error.message}</Text>
                    <Button onClick={handleReload}>Try again</Button>
                </div>
            </main>
        )
    } else {
        return (
            <>
                <PlaygroundHeader key={`${uri}-header`} />
                <PlaygroundMainView key={`${uri}-main`} />
            </>
        )
    }
}
const DevToolsWrapper = ({children}: {children: JSX.Element}) => {
    return process.env.NODE_ENV === "development" ? <SWRDevTools>{children}</SWRDevTools> : children
}

const Playground: FC = () => {
    usePlayground({
        hookId: "playground",
    })

    return (
        <DevToolsWrapper>
            <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
                <PlaygroundWrapper />
            </div>
        </DevToolsWrapper>
    )
}

export default Playground

import {useCallback, type JSX, type FC} from "react"

import {Typography} from "antd"
import dynamic from "next/dynamic"

import usePlayground from "./hooks/usePlayground"
import AppContext from "./state/messageContext"

const Spin = dynamic(() => import("antd/lib/spin"), {ssr: false})
const Button = dynamic(() => import("antd/lib/button"), {ssr: false})
const PlaygroundMainView = dynamic(() => import("./Components/MainLayout"), {ssr: false})
const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})
const SWRDevTools = dynamic(() => import("swr-devtools").then((mod) => mod.SWRDevTools), {
    ssr: false,
})

const {Title, Text} = Typography
const PlaygroundWrapper = () => {
    const {
        err: error,
        isLoading,
        uri,
        mutate,
    } = usePlayground({
        stateSelector: (state) => {
            return {
                err: state.error,
                uri: state.uri,
            }
        },
    })

    const handleReload = useCallback(() => {
        mutate((data) => data, {
            revalidate: true,
        })
    }, [])

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
                <AppContext />
                <PlaygroundWrapper />
            </div>
        </DevToolsWrapper>
    )
}

export default Playground

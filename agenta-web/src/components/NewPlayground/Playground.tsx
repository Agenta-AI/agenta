import dynamic from "next/dynamic"
import {SWRDevTools} from "swr-devtools"

import {componentLogger} from "./assets/utilities/componentLogger"
import usePlayground from "./hooks/usePlayground"
import AppContext from "./state/messageContext"
import {Typography} from "antd"
import {useCallback} from "react"

const Spin = dynamic(() => import("antd/lib/spin"), {ssr: false})
const Button = dynamic(() => import("antd/lib/button"), {ssr: false})
const PlaygroundMainView = dynamic(() => import("./Components/MainLayout"), {ssr: false})
const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})

const {Title} = Typography
const PlaygroundWrapper = ({children}) => {
    const {
        err: error,
        isLoading,
        mutate,
    } = usePlayground({
        stateSelector: (state) => {
            return {
                err: state.error,
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
                    <Button onClick={handleReload}>Try loading playground again</Button>
                </div>
            </main>
        )
    } else {
        return (
            <>
                <PlaygroundHeader />
                <PlaygroundMainView />
            </>
        )
    }
}
const DevToolsWrapper = ({children}: {children: JSX.Element}) => {
    return process.env.NODE_ENV === "development" ? <SWRDevTools>{children}</SWRDevTools> : children
}

const Playground: React.FC = () => {
    usePlayground({
        hookId: "playground",
    })

    componentLogger("Playground")

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

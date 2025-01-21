import dynamic from "next/dynamic"
import {SWRDevTools} from "swr-devtools"

import PlaygroundMainView from "./Components/MainLayout"
import {componentLogger} from "./assets/utilities/componentLogger"
import usePlayground from "./hooks/usePlayground"
import AppContext from "./state/messageContext"

const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})

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
                <PlaygroundHeader />
                <PlaygroundMainView />
            </div>
        </DevToolsWrapper>
    )
}

export default Playground

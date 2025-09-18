import {type FC} from "react"

import PlaygroundMainView from "./Components/MainLayout"
import PlaygroundHeader from "./Components/PlaygroundHeader"

const Playground: FC = () => {
    const uri = "playground" // Static value, no need for complex data subscription
    return (
        <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
            <PlaygroundHeader key={`${uri}-header`} />
            <PlaygroundMainView key={`${uri}-main`} />
        </div>
    )
}

export default Playground

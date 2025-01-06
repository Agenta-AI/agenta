import {useRouter} from "next/router"
import dynamic from "next/dynamic"
import {SWRDevTools} from "swr-devtools"

import PlaygroundMainView from "./Components/MainLayout"
import {componentLogger} from "./assets/utilities/componentLogger"
import usePlayground from "./hooks/usePlayground"

import {AVAILABLE_SERVICES} from "./assets/constants"

const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})

const Playground: React.FC = () => {
    const router = useRouter()
    const service = router.query.service as string
    usePlayground({
        hookId: "playground",
    })

    componentLogger("Playground", service)

    if (!service || !AVAILABLE_SERVICES.includes(service)) {
        return (
            <div>
                <h1>Service not found</h1>
                <p>available services are:</p>
                <ul>
                    {AVAILABLE_SERVICES.map((service) => (
                        <li key={service}>{service}</li>
                    ))}
                </ul>
            </div>
        )
    }

    return (
        <SWRDevTools>
            <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
                <PlaygroundHeader />
                <PlaygroundMainView />
            </div>
        </SWRDevTools>
    )
}

export default Playground

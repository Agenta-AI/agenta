import {useRouter} from "next/router"
import {AVAILABLE_SERVICES} from "./assets/constants"
import dynamic from "next/dynamic"
import PlaygroundVariants from "./Components/PlaygroundVariants"
import usePlayground from "./hooks/usePlayground"
import { SWRDevTools } from "swr-devtools";
const PlaygroundHeader = dynamic(() => import("./Components/PlaygroundHeader"), {ssr: false})

const Playground: React.FC = () => {
    const router = useRouter()
    const service = router.query.service as string
    usePlayground({
        hookId: "playground",
    })
    
    console.log("usePlayground[%cComponent%c] - Playground - RENDER!" , "color: orange", "")

    if (!service || !AVAILABLE_SERVICES.includes(service)) {
        return (
            <div>
                <h1>Service not found</h1>
                <p>available services are:</p>
                <ul>
                    {
                        AVAILABLE_SERVICES.map((service) => (
                            <li key={service}>{service}</li>
                        ))
                    }
                </ul>
            </div>
        )
    }

    return (
        <SWRDevTools>
            <div className="flex flex-col w-full h-[calc(100dvh-70px)] overflow-hidden">
                <PlaygroundHeader />
                <PlaygroundVariants />
            </div>
        </SWRDevTools>
    )
}

export default Playground

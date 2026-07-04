import {useEffect} from "react"

import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import {ENABLE_AGENT_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import {urlAtom} from "@/oss/state/url"

const TemplatesGallery = dynamic(
    () => import("@/oss/components/pages/agent-home/components/TemplatesGallery"),
)

/** Full templates gallery — only reachable when the agent onboarding flag is on. */
export default function TemplatesPage() {
    const router = useRouter()
    const {baseAppURL} = useAtomValue(urlAtom)

    // Without the flag there is no templates surface; send the user back to Home.
    useEffect(() => {
        if (!ENABLE_AGENT_ONBOARDING && baseAppURL) {
            router.replace(baseAppURL)
        }
    }, [baseAppURL, router])

    return ENABLE_AGENT_ONBOARDING ? <TemplatesGallery /> : null
}

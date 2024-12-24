import {useState, useEffect, useCallback, ComponentType, useRef} from "react"
import Head from "next/head"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"

const GlobalScripts = () => {
    const [CloudScripts, setCloudScripts] = useState<ComponentType | null>(null)
    const isLoading = useRef(false)

    const initializeScripts = useCallback(() => {
        const Scripts = dynamicComponent("Scripts/assets/CloudScripts")
        setCloudScripts(() => Scripts)
    }, [])

    useEffect(() => {
        if (!isLoading.current && isDemo()) {
            isLoading.current = true

            initializeScripts()
        }
    }, [initializeScripts])

    if (isDemo() && CloudScripts) {
        return <CloudScripts />
    }

    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
            </Head>
        </>
    )
}

export default GlobalScripts

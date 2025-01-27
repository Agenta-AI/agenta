import {useState, useEffect, useCallback, ComponentType} from "react"
import Head from "next/head"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"

const GlobalScripts = () => {
    const [CloudScripts, setCloudScripts] = useState<ComponentType | null>(null)

    const initializeScripts = useCallback(() => {
        const Scripts = dynamicComponent("Scripts/assets/CloudScripts")
        setCloudScripts((prev: any) => prev ?? Scripts)
    }, [])

    useEffect(() => {
        if (!CloudScripts && isDemo()) {
            initializeScripts()
        }
    }, [initializeScripts, CloudScripts])

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

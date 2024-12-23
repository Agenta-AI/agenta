import {useState, useEffect, useCallback} from "react"
import Head from "next/head"
import {isDemo} from "@/lib/helpers/utils"
import {dynamicComponent} from "@/lib/helpers/dynamic"

const GlobalScripts = () => {
    const [CloudScripts, setCloudScripts] = useState<React.ComponentType | null>(null)

    const initilizeScripts = useCallback(async () => {
        const Scripts = dynamicComponent("Scripts/assets/CloudScripts")
        setCloudScripts(() => Scripts)
    }, [])

    useEffect(() => {
        if (isDemo()) {
            initilizeScripts()
        }
    }, [initilizeScripts])

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

import {useState, useEffect, useCallback} from "react"
import Head from "next/head"
import {isDemo} from "@/lib/helpers/utils"

const GlobalScripts = () => {
    const [CloudScripts, setCloudScripts] = useState<React.ComponentType | null>(null)

    const initilizeScripts = useCallback(async () => {
        // @ts-ignore
        const Scripts = (await import("./assets/CloudScripts")).default
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

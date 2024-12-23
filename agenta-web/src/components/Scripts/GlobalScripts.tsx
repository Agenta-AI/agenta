import {useState, useEffect} from "react"
import Head from "next/head"
import {isDemo} from "@/lib/helpers/utils"

const GlobalScripts = () => {
    const [CloudScripts, setCloudScripts] = useState<React.ComponentType | null>(null)

    useEffect(() => {
        if (isDemo()) {
            const loadCloudScripts = async () => {
                const module = await import("./assets/CloudScripts")
                setCloudScripts(() => module.default)
            }
            loadCloudScripts()
        }
    }, [])

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

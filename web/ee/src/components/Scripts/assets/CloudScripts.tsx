import {useEffect} from "react"

import {Crisp} from "crisp-sdk-web"
import Head from "next/head"
import Script from "next/script"

import {getEnv} from "@/oss/lib/helpers/dynamicEnv"

const CloudScripts = () => {
    useEffect(() => {
        const isCrispEnabled = !!getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID")

        if (!isCrispEnabled) {
            return
        }

        Crisp.configure(getEnv("NEXT_PUBLIC_CRISP_WEBSITE_ID"))
    }, [])

    return (
        <>
            <Head>
                <title>Agenta: The LLMOps platform.</title>
                <link rel="shortcut icon" href="/assets/favicon.ico" />
                <script
                    type="text/javascript"
                    src="https://app.termly.io/embed.min.js/8e05e2f3-b396-45dd-bb76-4dfa5ce28e10?autoBlock=on"
                ></script>
            </Head>
            <div className="container">
                <Script src="/__env.js" strategy="beforeInteractive" />
                <Script src="https://www.googletagmanager.com/gtag/js?id=G-PV7R8H9KDM" />
                <Script id="google-analytics">
                    {`
          window.dataLayer = window.dataLayer || [];
          function gtag(){dataLayer.push(arguments);}
          gtag('js', new Date());
 
          gtag('config', 'G-PV7R8H9KDM');
        `}
                </Script>
            </div>
        </>
    )
}

export default CloudScripts

import Head from "next/head"

import {ContextResolver} from "@/features/context/ContextResolver"

// Thin shell: `/m/` resolves a workspace/project context and forwards to its
// sessions list (or shows the raw picker / signed-out notice).
export default function Home() {
    return (
        <>
            <Head>
                <title>Agenta Mobile</title>
            </Head>
            <ContextResolver />
        </>
    )
}

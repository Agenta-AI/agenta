import Head from "next/head"

import {DesignSystemScreen} from "@/features/design-guide/DesignSystemScreen"

export default function DesignSystemPage() {
    return (
        <>
            <Head>
                <title>Design system</title>
            </Head>
            <DesignSystemScreen />
        </>
    )
}

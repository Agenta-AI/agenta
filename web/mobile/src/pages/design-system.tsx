import Head from "next/head"

import {DesignSystemScreen} from "@/features/design-system/DesignSystemScreen"

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

import type {GetStaticProps} from "next"
import Head from "next/head"

import {DesignSystemScreen} from "@/features/design-guide/DesignSystemScreen"

// The design guide is a developer reference. Production builds answer with the 404 page.
export const getStaticProps: GetStaticProps = async () => {
    if (process.env.NODE_ENV === "production") return {notFound: true}
    return {props: {}}
}

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

import Head from "next/head"

import {OidcCallbackScreen} from "@/features/auth/OidcCallbackScreen"

// Thin shell: /m/auth/callback/<providerId> — the device gate forwards the
// provider's landing here when the mobile app started the flow.
export default function AuthCallback() {
    return (
        <>
            <Head>
                <title>Signing in · Agenta</title>
            </Head>
            <OidcCallbackScreen />
        </>
    )
}

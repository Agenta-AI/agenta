import Head from "next/head"

import {SignInScreen} from "@/features/auth/SignInScreen"

// Thin shell: raw email/password sign-in (auth-lite). On success the root
// context resolver takes over.
export default function Auth() {
    return (
        <>
            <Head>
                <title>Sign in — Agenta</title>
            </Head>
            <SignInScreen />
        </>
    )
}

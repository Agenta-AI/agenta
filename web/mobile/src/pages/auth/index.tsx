import Head from "next/head"

import {SignInScreen} from "@/features/auth/SignInScreen"

// Thin shell: every sign-in method this deployment enables (password or
// one-time code, plus OIDC). On success the root context resolver takes over.
export default function Auth() {
    return (
        <>
            <Head>
                <title>Sign in · Agenta</title>
            </Head>
            <SignInScreen />
        </>
    )
}

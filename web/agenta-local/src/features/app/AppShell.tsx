import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {useEffect, type PropsWithChildren} from "react"

import {RuntimeBanner} from "@/features/runtime/RuntimeBanner"
import {providersQueryAtom} from "@/lib/state/providers"

import {Navigation} from "./Navigation"

export const AppShell = ({children}: PropsWithChildren) => {
    const router = useRouter()
    const providers = useAtomValue(providersQueryAtom)
    const hasProvider = providers.data?.some((provider) => provider.configured) ?? false

    useEffect(() => {
        if (
            !providers.isPending &&
            !providers.isError &&
            !hasProvider &&
            router.pathname !== "/providers"
        ) {
            void router.replace({pathname: "/providers", query: {first_run: "1"}})
        }
    }, [hasProvider, providers.isError, providers.isPending, router])

    return (
        <div className="app-frame">
            <Navigation />
            <div className="app-stage">
                <RuntimeBanner />
                <main className="page-main">{children}</main>
            </div>
        </div>
    )
}

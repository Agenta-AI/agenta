import {Spin} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"
import {useEffect} from "react"

import {agentsQueryAtom} from "@/lib/state/agents"
import {providersQueryAtom} from "@/lib/state/providers"
import {sessionsQueryAtom} from "@/lib/state/sessions"

export default function HomePage() {
    const router = useRouter()
    const providers = useAtomValue(providersQueryAtom)
    const agents = useAtomValue(agentsQueryAtom)
    const sessions = useAtomValue(sessionsQueryAtom)

    useEffect(() => {
        if (providers.isPending || agents.isPending || sessions.isPending) return
        const target = !providers.data?.some((provider) => provider.configured)
            ? "/providers/?first_run=1"
            : !agents.data?.length
              ? "/agents/"
              : "/sessions/"
        void router.replace(target)
    }, [
        agents.data,
        agents.isPending,
        providers.data,
        providers.isPending,
        router,
        sessions.isPending,
    ])

    return (
        <div className="center-state">
            <Spin size="large" tip="Opening Agenta Local" />
        </div>
    )
}

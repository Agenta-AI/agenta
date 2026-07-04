import dynamic from "next/dynamic"

import {ENABLE_AGENT_ONBOARDING} from "@/oss/components/pages/agent-home/assets/constants"
import AppManagement from "@/oss/components/pages/app-management"

const AgentHome = dynamic(() => import("@/oss/components/pages/agent-home"))

export default function Apps() {
    return ENABLE_AGENT_ONBOARDING ? <AgentHome /> : <AppManagement />
}

import dynamic from "next/dynamic"

const AgentHome = dynamic(() => import("@/oss/components/pages/agent-home"))

export default function Apps() {
    return <AgentHome />
}

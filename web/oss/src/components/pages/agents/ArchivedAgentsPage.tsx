import {PageLayout} from "@agenta/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button} from "antd"
import {useRouter} from "next/router"

import ApplicationManagementSection from "@/oss/components/pages/app-management/components/ApplicationManagementSection"
import useURL from "@/oss/hooks/useURL"

export default function ArchivedAgentsPage() {
    const router = useRouter()
    const {projectURL} = useURL()
    const title = (
        <span className="inline-flex items-center gap-2">
            <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={16} />}
                onClick={() => router.push(`${projectURL}/agents`)}
                className="!px-1"
                aria-label="Back to agents"
            />
            <span>Archived Agents</span>
        </span>
    )

    return (
        <PageLayout title={title} className="grow min-h-0">
            <ApplicationManagementSection mode="archived" agentScope />
        </PageLayout>
    )
}

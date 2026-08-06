import {PageLayout} from "@agenta/ui"
import {ArrowLeft} from "@phosphor-icons/react"
import {Button} from "antd"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

import ApplicationManagementSection from "./components/ApplicationManagementSection"

export default function ArchivedAppsPage() {
    const router = useRouter()
    const {baseAppURL} = useURL()

    // Mirror the Archived Evaluators header: the back arrow sits inline with the
    // title (no standalone "Back" button, no subtitle) so both archived pages
    // share one layout via PageLayout.
    const title = (
        <span className="inline-flex items-center gap-2">
            <Button
                type="text"
                size="small"
                icon={<ArrowLeft size={16} />}
                onClick={() => router.push(baseAppURL)}
                className="!px-1"
                aria-label="Back to apps"
            />
            <span>Archived Apps</span>
        </span>
    )

    return (
        <PageLayout title={title} className="grow min-h-0">
            <ApplicationManagementSection mode="archived" />
        </PageLayout>
    )
}

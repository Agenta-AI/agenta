import {useRouter} from "next/router"

import ArchivedEntityLayout from "@/oss/components/ArchivedEntityLayout"
import useURL from "@/oss/hooks/useURL"

import ApplicationManagementSection from "./components/ApplicationManagementSection"

export default function ArchivedAppsPage() {
    const router = useRouter()
    const {baseAppURL} = useURL()

    return (
        <ArchivedEntityLayout
            title="Archived Apps"
            subtitle="Archived apps are hidden from your workspace but can be restored at any time."
            onBack={() => router.push(baseAppURL)}
        >
            <ApplicationManagementSection mode="archived" />
        </ArchivedEntityLayout>
    )
}

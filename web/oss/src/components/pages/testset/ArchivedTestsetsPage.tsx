import {useRouter} from "next/router"

import ArchivedEntityLayout from "@/oss/components/ArchivedEntityLayout"
import TestsetsTable from "@/oss/components/TestsetsTable/TestsetsTable"
import useURL from "@/oss/hooks/useURL"

export default function ArchivedTestsetsPage() {
    const router = useRouter()
    const {projectURL} = useURL()

    return (
        <ArchivedEntityLayout
            title="Archived Testsets"
            subtitle="Archived testsets are hidden from your workspace but can be restored at any time."
            onBack={() => router.push(`${projectURL}/testsets`)}
        >
            <TestsetsTable tableMode="archived" />
        </ArchivedEntityLayout>
    )
}

import {PageLayout} from "@agenta/ui"

import TestsetsTable from "@/oss/components/TestsetsTable/TestsetsTable"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"

const Testset = () => {
    useBreadcrumbsEffect({breadcrumbs: {testsets: {label: "testsets"}}}, [])

    return (
        <PageLayout title="Testsets" className="grow min-h-0">
            <TestsetsTable />
        </PageLayout>
    )
}

export default Testset

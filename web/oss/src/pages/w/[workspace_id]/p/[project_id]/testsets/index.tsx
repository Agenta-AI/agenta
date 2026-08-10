import {PageLayout} from "@agenta/ui"

import PageTitle from "@/oss/components/PageTitle"
import TestsetsTable from "@/oss/components/TestsetsTable/TestsetsTable"

const Testset = () => {
    return (
        <>
            <PageTitle title="Test sets" />
            <PageLayout title="Testsets" className="grow min-h-0">
                <TestsetsTable />
            </PageLayout>
        </>
    )
}

export default Testset

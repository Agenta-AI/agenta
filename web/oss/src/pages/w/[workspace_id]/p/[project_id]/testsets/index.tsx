import TestsetsTable from "@/oss/components/TestsetsTable/TestsetsTable"
import {useBreadcrumbsEffect} from "@/oss/lib/hooks/useBreadcrumbs"

const Testset = () => {
    useBreadcrumbsEffect({breadcrumbs: {testsets: {label: "testsets"}}}, [])

    return (
        <div className="p-6 flex flex-col h-full min-h-0 grow w-full">
            <TestsetsTable />
        </div>
    )
}

export default Testset

import {Modal} from "antd"

import {testset} from "@/oss/lib/Types"

export type EvaluatorTestcaseModalProps = {
    testsets: testset[]
    setSelectedTestcase: React.Dispatch<
        React.SetStateAction<{
            testcase: Record<string, any> | null
        }>
    >
    setSelectedTestset: React.Dispatch<React.SetStateAction<string>>
    selectedTestset: string
} & React.ComponentProps<typeof Modal>

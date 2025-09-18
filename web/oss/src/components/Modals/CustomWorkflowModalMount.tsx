import {useAtomValue} from "jotai"

import CustomWorkflowModal from "@/oss/components/pages/app-management/modals/CustomWorkflowModal"
import {customWorkflowModalPropsAtom} from "@/oss/state/customWorkflow/modalAtoms"

const CustomWorkflowModalMount = () => {
    const props = useAtomValue(customWorkflowModalPropsAtom)
    return <CustomWorkflowModal {...props} />
}

export default CustomWorkflowModalMount

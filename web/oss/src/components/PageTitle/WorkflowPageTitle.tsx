import {useAtomValue} from "jotai"

import {currentWorkflowContextAtom} from "@/oss/state/workflow"

import PageTitle from "."

const WorkflowPageTitle = ({title}: {title: string}) => {
    const workflow = useAtomValue(currentWorkflowContextAtom).workflow
    const workflowName = workflow?.name || workflow?.slug

    // A pending context falls back: the section name is already right, so holding it back would show less.
    return <PageTitle title={title} context={workflowName} />
}

export default WorkflowPageTitle

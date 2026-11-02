import {memo} from "react"

import {WorkflowPickerView} from "@agenta/navigation-ui"

import {useWorkflowSwitcher} from "../hooks/useWorkflowSwitcher"

import WorkflowIdentity from "./WorkflowIdentity"

interface WorkflowPickerProps {
    collapsed: boolean
}

/** OSS binding: workflow catalog + navigation wired onto the shared picker view. */
const WorkflowPicker = memo(({collapsed}: WorkflowPickerProps) => {
    const {displayName, entries, handleSelect, isEvaluator, open, setOpen, workflowId} =
        useWorkflowSwitcher()

    return (
        <WorkflowPickerView
            collapsed={collapsed}
            open={open}
            onOpenChange={setOpen}
            entries={entries}
            onSelect={handleSelect}
            triggerContent={
                <WorkflowIdentity
                    workflowId={workflowId}
                    name={displayName}
                    isEvaluator={isEvaluator}
                    showDetails={!collapsed}
                />
            }
        />
    )
})

WorkflowPicker.displayName = "WorkflowPicker"

export default WorkflowPicker

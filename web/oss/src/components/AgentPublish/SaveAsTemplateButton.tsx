import {Button, SimpleTooltip} from "@agenta/ui/ui"
import {Export} from "@phosphor-icons/react"

import {useSaveAsTemplate} from "./useSaveAsTemplate"

/** Quiet outline action beside Publish; exact placement is still a design decision. */
const SaveAsTemplateButton = ({entityId}: {entityId: string | null | undefined}) => {
    const {saveAsTemplate, disabled} = useSaveAsTemplate(entityId)

    return (
        <SimpleTooltip title="Ask the agent to package itself as a template you can share">
            <span className="inline-flex shrink-0">
                <Button
                    variant="outline"
                    size="sm"
                    disabled={disabled}
                    onClick={() => saveAsTemplate()}
                    aria-label="Save as template"
                    data-testid="save-as-template-button"
                >
                    <Export size={14} />
                    <span className="hidden sm:inline">Save as template</span>
                </Button>
            </span>
        </SimpleTooltip>
    )
}

export default SaveAsTemplateButton

import {
    SAVE_AS_TEMPLATE_MESSAGE,
    SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE,
} from "@agenta/entities/workflow"
import {
    Button,
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
    SimpleTooltip,
} from "@agenta/ui/ui"
import {Export} from "@phosphor-icons/react"

import {useSaveAsTemplate} from "./useSaveAsTemplate"

/**
 * Quiet icon menu beside Publish: save the agent as a template zip, or share it in the
 * marketplace. Each item sends one chat request; the same menu the Publish button uses.
 */
const SaveAsTemplateButton = ({entityId}: {entityId: string | null | undefined}) => {
    const {sendTemplateRequest, disabled} = useSaveAsTemplate(entityId)

    return (
        <DropdownMenu>
            <SimpleTooltip title="Template options">
                <span className="inline-flex shrink-0">
                    <DropdownMenuTrigger asChild disabled={disabled}>
                        <Button
                            variant="ghost"
                            size="icon-sm"
                            aria-label="Template options"
                            data-testid="template-options-button"
                        >
                            <Export size={16} />
                        </Button>
                    </DropdownMenuTrigger>
                </span>
            </SimpleTooltip>
            <DropdownMenuContent align="end">
                <DropdownMenuItem
                    onSelect={() => sendTemplateRequest(SAVE_AS_TEMPLATE_MESSAGE)}
                    data-testid="template-options-save-zip"
                >
                    Save as template (.zip)
                </DropdownMenuItem>
                <DropdownMenuItem
                    onSelect={() => sendTemplateRequest(SHARE_TEMPLATE_IN_MARKETPLACE_MESSAGE)}
                    data-testid="template-options-share-marketplace"
                >
                    Share as template in the marketplace
                </DropdownMenuItem>
            </DropdownMenuContent>
        </DropdownMenu>
    )
}

export default SaveAsTemplateButton

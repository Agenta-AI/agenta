import {Badge} from "@agenta/ui/ui"
import {LightningIcon} from "@phosphor-icons/react"

/** When a template runs ("Pull request opened"), as a chip. */
export const TriggerBadge = ({trigger}: {trigger: string}) => (
    <Badge icon={<LightningIcon weight="fill" aria-hidden className="size-3" />}>{trigger}</Badge>
)

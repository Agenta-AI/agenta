import {Button} from "@agenta/ui/ui"
import {EnvelopeSimple} from "@phosphor-icons/react"

export interface EmailChipProps {
    email: string
    /** Back to the address step. */
    onChange: () => void
}

/** The address a sign-in step carries forward, with a way back to change it. */
export const EmailChip = ({email, onChange}: EmailChipProps) => (
    <div className="flex h-8 max-w-full items-center gap-2 self-start rounded-lg border border-solid border-border bg-background py-0 pl-2.5 pr-1 text-[13px] leading-5 text-foreground">
        <EnvelopeSimple size={14} className="flex-none text-muted-foreground" />
        <span className="truncate">{email}</span>
        <Button
            type="button"
            variant="ghost"
            size="xs"
            className="flex-none text-[13px] font-medium text-muted-foreground hover:text-foreground"
            onClick={onChange}
        >
            Change
        </Button>
    </div>
)

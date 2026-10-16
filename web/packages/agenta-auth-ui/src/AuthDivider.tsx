import {Divider} from "@agenta/ui/ui"

/** The "or" rule between the social block and the email block. */
export const AuthDivider = ({label = "or"}: {label?: string}) => (
    <Divider plain className="my-0 text-xs leading-[18px] text-muted-foreground">
        {label}
    </Divider>
)

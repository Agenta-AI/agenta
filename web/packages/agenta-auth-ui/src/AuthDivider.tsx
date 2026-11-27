import {Divider} from "@agenta/ui/ui"

/** The "or" rule between the social block and the email block; the caller translates `label`. */
export const AuthDivider = ({label}: {label: string}) => (
    <Divider plain className="my-0 text-meta text-muted-foreground">
        {label}
    </Divider>
)

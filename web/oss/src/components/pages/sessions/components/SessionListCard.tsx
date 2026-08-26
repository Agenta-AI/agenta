import {SessionListCard as SharedSessionListCard} from "@agenta/sessions-ui"

import useURL from "@/oss/hooks/useURL"

import {useSessionCardVerbs} from "./useSessionCardVerbs"

type Props = Omit<
    React.ComponentProps<typeof SharedSessionListCard>,
    "viewAllHref" | "onOpenRow" | "menuFor" | "onMenuSelect"
> & {
    /** Defaults to the project sessions page; an agent-scoped page carries its own route. */
    viewAllHref?: string
}

/** OSS binding: the shared session list card wired to this app's verbs. */
const SessionListCard = ({viewAllHref, ...props}: Props) => {
    const verbs = useSessionCardVerbs()
    const {projectURL} = useURL()
    return (
        <SharedSessionListCard
            {...props}
            viewAllHref={viewAllHref ?? `${projectURL}/sessions`}
            {...verbs}
        />
    )
}

export default SessionListCard

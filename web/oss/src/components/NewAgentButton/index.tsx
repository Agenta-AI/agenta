import {AGENT_TEMPLATES} from "@agenta/entities/workflow"
import {NewAgentButton as NewAgentButtonView} from "@agenta/home-ui"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

/**
 * App adapter over the shared button: this app's create surface is a route (`?new=1`), so both
 * the blank path and a template pick are pushes onto it. The button itself — and the choice of
 * what it offers — is the package's.
 */
const NewAgentButton = ({label}: {label?: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    const goCreate = (templateKey?: string) =>
        void router.push(
            templateKey ? `${baseAppURL}?new=1&template=${templateKey}` : `${baseAppURL}?new=1`,
        )

    return (
        <NewAgentButtonView
            label={label}
            onCreateBlank={() => goCreate()}
            templates={AGENT_TEMPLATES}
            onPickTemplate={goCreate}
            browseHref={`${baseAppURL}/agent-templates`}
            totalTemplates={AGENT_TEMPLATES.length}
        />
    )
}

export default NewAgentButton

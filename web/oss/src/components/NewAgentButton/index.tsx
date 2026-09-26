import {NewAgentButton as NewAgentButtonView} from "@agenta/home-ui"
import {useRouter} from "next/router"

import {useAgentTemplateCatalog} from "@/oss/components/TemplateStrip/hooks/useAgentTemplateCatalog"
import useURL from "@/oss/hooks/useURL"

/**
 * App adapter over the shared button: this app's create surface is a route (`?new=1`), so both
 * the blank path and a template pick are pushes onto it. The button itself — and the choice of
 * what it offers — is the package's.
 */
const NewAgentButton = ({label}: {label?: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()
    const {templates, status} = useAgentTemplateCatalog()
    // Until the catalog loads the menu offers only the blank create: the browse link names a
    // count, and "Browse all 0 templates" would read as an empty catalog. The gallery page shows
    // its own loading and error states.
    const catalogReady = status === "success"

    const goCreate = (templateKey?: string) =>
        void router.push(
            templateKey ? `${baseAppURL}?new=1&template=${templateKey}` : `${baseAppURL}?new=1`,
        )

    return (
        <NewAgentButtonView
            label={label}
            onCreateBlank={() => goCreate()}
            templates={templates}
            onPickTemplate={goCreate}
            browseHref={catalogReady ? `${baseAppURL}/agent-templates` : undefined}
            totalTemplates={templates.length}
        />
    )
}

export default NewAgentButton

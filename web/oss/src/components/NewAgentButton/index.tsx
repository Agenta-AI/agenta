import {NewAgentButton as NewAgentButtonView} from "@agenta/home-ui"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"

/** App adapter over the shared button: this app's create surface is a route (`?new=1`). */
const NewAgentButton = ({label}: {label?: string}) => {
    const router = useRouter()
    const {baseAppURL} = useURL()

    return (
        <NewAgentButtonView
            label={label}
            onCreateBlank={() => void router.push(`${baseAppURL}?new=1`)}
            browseHref={`${baseAppURL}/agent-templates`}
        />
    )
}

export default NewAgentButton

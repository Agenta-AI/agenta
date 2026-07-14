import {CustomProviderForm} from "@agenta/entity-ui/secretProvider"

import {ConfigureProviderDrawerContentProps} from "./types"

// Thin shell: the form itself lives in @agenta/entity-ui so a future inline drawer pane
// can render the exact same custom-provider add/edit flow.
const ConfigureProviderDrawerContent = (props: ConfigureProviderDrawerContentProps) => (
    <CustomProviderForm {...props} />
)

export default ConfigureProviderDrawerContent

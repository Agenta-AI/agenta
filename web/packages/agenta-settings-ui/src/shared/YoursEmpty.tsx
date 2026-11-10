import {User} from "@phosphor-icons/react"

import {yoursEmptyBody} from "./accountOwners"
import {SettingsEmpty} from "./SettingsEmpty"

/** "Yours" with nothing in it: the page's own plain empty state. */
export const YoursEmpty = ({projectCount}: {projectCount?: number}) => (
    <SettingsEmpty
        plain
        icon={<User size={18} />}
        title="No accounts of your own yet"
        description={yoursEmptyBody(projectCount)}
    />
)

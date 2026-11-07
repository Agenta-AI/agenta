import {useT} from "@agenta/i18n/settings"
import {User} from "@phosphor-icons/react"

import {yoursEmptyBody} from "./accountOwners"
import {SettingsEmpty} from "./SettingsEmpty"

/** "Yours" with nothing in it: the page's own plain empty state. */
export const YoursEmpty = ({projectCount}: {projectCount?: number}) => {
    const t = useT()
    return (
        <SettingsEmpty
            plain
            icon={<User size={18} />}
            title={t("settings.shared.yoursEmptyTitle")}
            description={yoursEmptyBody(projectCount)}
        />
    )
}

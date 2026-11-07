import type {ReactNode} from "react"

import {richText} from "@agenta/i18n"
import {useT} from "@agenta/i18n/settings"

import {SettingsEmpty} from "../shared/SettingsEmpty"

export interface UpgradeNoticeProps {
    /** The locked tab's sidebar icon. */
    icon: ReactNode
    title: string
    description: string
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
}

/** Stands in for a section the current plan does not include, framed like every empty page. */
export const UpgradeNotice = ({icon, title, description, action}: UpgradeNoticeProps) => {
    const t = useT()
    return (
        <SettingsEmpty
            icon={icon}
            title={title}
            description={
                <>
                    {description}
                    <span className="mt-2 block">
                        {richText(t("settings.access.availableOnPlans"), {
                            strong: (text) => <strong>{text}</strong>,
                        })}
                    </span>
                </>
            }
            action={action}
        />
    )
}

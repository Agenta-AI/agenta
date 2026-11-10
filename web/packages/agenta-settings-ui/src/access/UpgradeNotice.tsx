import type {ReactNode} from "react"

import {SettingsEmpty} from "../shared/SettingsEmpty"

export interface UpgradeNoticeProps {
    /** The locked tab's sidebar icon. */
    icon: ReactNode
    title: string
    description: string
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
    /** Where the feature is available. Defaults to the cloud plans that include it. */
    availability?: ReactNode
}

/** Stands in for a section the current plan does not include, framed like every empty page. */
export const UpgradeNotice = ({
    icon,
    title,
    description,
    action,
    availability = (
        <>
            Available on <strong>Business</strong> and <strong>Enterprise</strong> plans.
        </>
    ),
}: UpgradeNoticeProps) => (
    <SettingsEmpty
        icon={icon}
        title={title}
        description={
            <>
                {description}
                <span className="mt-2 block">{availability}</span>
            </>
        }
        action={action}
    />
)

import type {ReactNode} from "react"

import {Lock} from "@phosphor-icons/react"

import {SettingsEmpty} from "../shared/SettingsEmpty"

export interface UpgradeNoticeProps {
    title: string
    description: string
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
}

/** Stands in for a section the current plan does not include, framed like every empty page. */
export const UpgradeNotice = ({title, description, action}: UpgradeNoticeProps) => (
    <SettingsEmpty
        icon={<Lock size={18} />}
        title={title}
        description={
            <>
                {description}
                <span className="mt-2 block">
                    Available on <strong>Business</strong> and <strong>Enterprise</strong> plans.
                </span>
            </>
        }
        action={action}
    />
)

import type {ReactNode} from "react"

import {Lock} from "@phosphor-icons/react"

export interface UpgradeNoticeProps {
    title: string
    description: string
    /** The upgrade link — routing and billing availability are the host's to decide. */
    action?: ReactNode
}

/** Stands in for a section the current plan does not include. */
export const UpgradeNotice = ({title, description, action}: UpgradeNoticeProps) => (
    <div className="rounded-lg border border-solid border-colorBorderSecondary bg-colorBgContainer">
        <div className="flex flex-col items-center justify-center px-6 py-12 text-center">
            <div className="mb-4 rounded-full bg-colorFillQuaternary p-4">
                <Lock size={32} className="text-colorTextTertiary" />
            </div>
            <h2 className="m-0 mb-2 text-lg font-medium text-colorText">{title}</h2>
            <p className="m-0 mb-4 block max-w-md text-xs text-colorTextSecondary">{description}</p>
            <p className="m-0 text-xs text-colorTextSecondary">
                Available on <strong>Business</strong> and <strong>Enterprise</strong> plans.{" "}
                {action}
            </p>
        </div>
    </div>
)

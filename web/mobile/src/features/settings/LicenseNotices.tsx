import {createT} from "@agenta/i18n"
import settingsLicenseCatalog from "@agenta/i18n/catalogs/settings.license"

import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense} from "./licenseApi"
import {useInstanceLicense} from "./useInstanceLicense"

const t = createT(settingsLicenseCatalog)

const EXPIRY_NOTICE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** What the instance admin must know about the key: it expired, expires soon, or seats ran out. */
export const licenseNotices = (license: InstanceLicense, now = Date.now()): string[] => {
    const key = license.license
    if (!key) return []
    if (key.expires_at && new Date(key.expires_at).getTime() <= now) {
        return [t("settings.license.noticeExpired", {date: formatDate(key.expires_at)})]
    }
    const notices: string[] = []
    if (key.expires_at && new Date(key.expires_at).getTime() - now <= EXPIRY_NOTICE_DAYS * DAY_MS) {
        notices.push(t("settings.license.noticeExpires", {date: formatDate(key.expires_at)}))
    }
    if (key.seats !== null && license.usage.users > key.seats) {
        notices.push(
            t("settings.license.noticeOverSeats", {
                users: t("settings.license.userCount", {count: license.usage.users}),
                seats: t("settings.license.seatCount", {count: key.seats}),
            }),
        )
    }
    return notices
}

/** On every settings page, for the instance admin only: license expiry and seat notices. */
export const LicenseNotices = ({projectId}: {projectId: string}) => {
    const license = useInstanceLicense(projectId)
    if (!license.data) return null
    const notices = licenseNotices(license.data)
    if (notices.length === 0) return null
    return (
        <div className="flex flex-col gap-1 pb-4">
            {notices.map((notice) => (
                <p key={notice} className="text-warning m-0 text-[13px]">
                    {notice}
                </p>
            ))}
        </div>
    )
}

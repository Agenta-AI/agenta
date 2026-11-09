import {formatDate} from "../wallet/walletFormat"

import type {InstanceLicense} from "./licenseApi"

const EXPIRY_NOTICE_DAYS = 30
const DAY_MS = 24 * 60 * 60 * 1000

/** What the instance admin must know about the key: it expired, expires soon, or seats ran out. */
export const licenseNotices = (license: InstanceLicense, now = Date.now()): string[] => {
    const key = license.license
    if (!key) return []
    if (key.expires_at && new Date(key.expires_at).getTime() <= now) {
        return [
            `This license expired on ${formatDate(key.expires_at)}. The instance is on the Community plan.`,
        ]
    }
    const notices: string[] = []
    if (key.expires_at && new Date(key.expires_at).getTime() - now <= EXPIRY_NOTICE_DAYS * DAY_MS) {
        notices.push(`This license expires on ${formatDate(key.expires_at)}.`)
    }
    if (key.seats !== null && license.usage.users > key.seats) {
        notices.push(
            `This instance has ${license.usage.users} users, more than the ${key.seats} seats of the license.`,
        )
    }
    return notices
}

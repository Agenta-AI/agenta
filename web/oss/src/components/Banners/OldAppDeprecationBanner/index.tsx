import {useMemo} from "react"

import {Alert, Typography} from "antd"
import clsx from "clsx"
import Link from "next/link"
import {useRouter} from "next/router"
import semver from "semver"

import {useAppsData} from "@/oss/contexts/app.context"

import packageJsonData from "../../../../package.json"

import {DEPRECATION_VERSION} from "./assets/constants"
import {CustomWorkflowBannerProps} from "./types"

const {Text} = Typography

const OldAppDeprecationBanner = ({isNewPlayground, children}: CustomWorkflowBannerProps) => {
    const {currentApp} = useAppsData()
    const router = useRouter()
    const isPlaygroundPage = useMemo(
        () => router.pathname.includes("/playground"),
        [router.pathname],
    )
    const isDeprecated = useMemo(() => {
        return semver.gte(packageJsonData.version, DEPRECATION_VERSION)
    }, [])
    const isLegacyApp = useMemo(() => currentApp?.app_type?.includes("(old)"), [currentApp])

    const getDeprecationMessage = () => {
        const versionText = isDeprecated
            ? `has been deprecated since v${DEPRECATION_VERSION}`
            : `is scheduled for deprecation in v${DEPRECATION_VERSION}`

        const migrationLink = (
            <Link
                href="/apps"
                className="font-medium !text-blue-600 hover:!text-blue-800 inline-block !underline underline-offset-1"
            >
                migrate to a new application
            </Link>
        )

        return (
            <>
                <Text>
                    The application you are viewing, <b>{currentApp?.app_name}</b>, is a legacy
                    application that {versionText}.
                </Text>
                <br />
                <Text>
                    {isPlaygroundPage ? (
                        <>
                            This playground is not accessible for legacy applications. Please{" "}
                            {migrationLink} to continue using the playground.
                        </>
                    ) : (
                        <>Please {migrationLink} to ensure continued functionality.</>
                    )}
                </Text>
            </>
        )
    }

    if (!isLegacyApp) return children

    return (
        <>
            <Alert
                className={clsx(!isNewPlayground ? "m-6" : "m-2", "[&_.anticon]:mt-1")}
                message="Legacy Application Detected"
                description={getDeprecationMessage()}
                showIcon
                type="warning"
            />
            {!isDeprecated ? children : !isPlaygroundPage && children}
        </>
    )
}

export default OldAppDeprecationBanner

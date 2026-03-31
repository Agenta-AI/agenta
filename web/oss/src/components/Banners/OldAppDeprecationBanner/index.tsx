import {useMemo} from "react"

import {Alert, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import Link from "next/link"
import {useRouter} from "next/router"
import semver from "semver"

import useURL from "@/oss/hooks/useURL"
import {currentAppAtom} from "@/oss/state/app"

import packageJsonData from "../../../../package.json"

import {DEPRECATION_VERSION} from "./assets/constants"
import {CustomWorkflowBannerProps} from "./types"

const {Text} = Typography

const OldAppDeprecationBanner = ({children}: CustomWorkflowBannerProps) => {
    const currentApp = useAtomValue(currentAppAtom)
    const router = useRouter()
    const {baseAppURL} = useURL()
    const isPlaygroundPage = useMemo(
        () => router.pathname.includes("/playground"),
        [router.pathname],
    )
    const isDeprecated = useMemo(() => {
        return semver.gte(packageJsonData.version, DEPRECATION_VERSION)
    }, [])
    const isLegacyApp = useMemo(() => currentApp?.app_type?.includes("(old)"), [currentApp])

    const getDeprecationMessage = () => {
        const migrationLink = (
            <Link
                href={baseAppURL}
                className="font-medium !text-blue-600 hover:!text-blue-800 inline-block !underline underline-offset-1"
            >
                migrate to a new application
            </Link>
        )

        return (
            <>
                <Text>
                    The application you are viewing, <b>{currentApp?.app_name}</b>, is a legacy
                    application that has been deprecated since v{DEPRECATION_VERSION}.
                </Text>
                <br />
                <Text>
                    {isPlaygroundPage ? (
                        <>
                            The playground is not accessible for legacy applications. To continue
                            using the playground, please {migrationLink} and set up a new
                            application.
                            <br />
                            To view variant details:
                            <ul className="list-disc ml-4">
                                <li>
                                    Navigate to the <b>Overview</b> page of your application.
                                </li>
                                <li>
                                    Scroll down to the <b>Variant Table</b>.
                                </li>
                                <li>
                                    Select the variant you need, open its details, and configure a
                                    new app in the playground using those values
                                </li>
                            </ul>
                        </>
                    ) : (
                        <>
                            {" "}
                            Please {migrationLink} to ensure uninterrupted access and continued
                            functionality.
                        </>
                    )}
                </Text>
            </>
        )
    }

    if (!isLegacyApp) return children

    return (
        <>
            <Alert
                className={clsx("m-2", "[&_.anticon]:mt-1")}
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

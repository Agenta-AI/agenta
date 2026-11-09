import {licenseNotices} from "./licenseNotices"
import {useInstanceLicense} from "./useInstanceLicense"

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

import {Settings} from "@agenta/oss/src/pages/w/[workspace_id]/p/[project_id]/settings"
import dynamic from "next/dynamic"

const AuditLog = dynamic(
    () => import("../../../../../../components/pages/settings/AuditLog/AuditLog"),
    {ssr: false},
)

const SettingsPage = () => <Settings AuditLogComponent={AuditLog} />

export default SettingsPage

import type {BrowserProfile} from "@agenta/entities/browserProfile"
import {getSettingsSidebarIcon} from "@agenta/settings"
import {StatusIndicator} from "@agenta/ui/components/presentational"
import {ListTable, type ListTableColumn} from "@agenta/ui/list-table"
import {Button} from "@agenta/ui/ui"
import {PencilSimple, Plus, SignIn, Trash} from "@phosphor-icons/react"

import {SettingsPageActions} from "../SettingsPageShell"
import {hoverableRow} from "../shared/hoverableRow"
import {SettingsEmpty} from "../shared/SettingsEmpty"
import {SettingsRowMenu} from "../shared/SettingsRowMenu"
import {usePhoneColumns} from "../shared/usePhoneColumns"

export interface BrowserLoginsPageProps {
    rows: BrowserProfile[]
    loading: boolean
    onCreate: () => void
    onLogin: (profile: BrowserProfile) => void
    onEditSites: (profile: BrowserProfile) => void
    onDelete: (profile: BrowserProfile) => void
}

const COLUMNS: ListTableColumn[] = [
    {key: "name", label: "Name", width: "minmax(0,1.4fr)"},
    {key: "sites", label: "Sites", width: "minmax(0,2fr)"},
    {key: "state", label: "Status", width: "minmax(0,1fr)"},
    {key: "updated_at", label: "Updated", width: "minmax(0,1fr)"},
    {key: "actions", label: "Actions", srOnly: true, width: "32px"},
]
const PHONE_KEYS = ["name", "state", "actions"]

export const BrowserLoginsPage = ({
    rows,
    loading,
    onCreate,
    onLogin,
    onEditSites,
    onDelete,
}: BrowserLoginsPageProps) => {
    const {columns, shows} = usePhoneColumns(COLUMNS, PHONE_KEYS)
    const add = (
        <Button disabled={loading} onClick={onCreate}>
            <Plus size={14} />
            Add login
        </Button>
    )

    return (
        <section className="flex flex-col">
            <SettingsPageActions>{add}</SettingsPageActions>
            <ListTable<BrowserProfile>
                columns={columns}
                minWidth={0}
                groups={[{key: "profiles", label: null, rows}]}
                wrapRow={hoverableRow}
                rowKey={(record) => record.id}
                loading={loading && rows.length === 0}
                hideHeader={!loading && rows.length === 0}
                empty={
                    <SettingsEmpty
                        icon={getSettingsSidebarIcon("browser-logins")}
                        title="No browser logins yet"
                        description="Sign in to a site once, and your agents can use it in a cloud browser. The browser only opens the sites you list. Agenta stores the cookies, never your password."
                        action={add}
                    />
                }
                renderRow={(record) => (
                    <>
                        <span className="truncate font-medium">{record.name}</span>
                        {shows("sites") ? (
                            <span className="truncate text-muted-foreground">
                                {record.allowed_hosts.join(", ") || "No sites"}
                            </span>
                        ) : null}
                        {record.state === "ready" ? (
                            <StatusIndicator tone="success" label="Signed in" />
                        ) : (
                            <StatusIndicator tone="warning" label="Needs login" />
                        )}
                        {shows("updated_at") ? (
                            <span className="truncate text-muted-foreground">
                                {record.updated_at
                                    ? new Date(record.updated_at).toLocaleDateString()
                                    : "—"}
                            </span>
                        ) : null}
                        <SettingsRowMenu
                            label="Login actions"
                            items={[
                                {
                                    key: "login",
                                    label: record.state === "ready" ? "Log in again" : "Log in",
                                    icon: <SignIn size={14} />,
                                    onClick: () => onLogin(record),
                                },
                                {
                                    key: "edit",
                                    label: "Edit sites",
                                    icon: <PencilSimple size={14} />,
                                    onClick: () => onEditSites(record),
                                },
                                {type: "divider"},
                                {
                                    key: "delete",
                                    label: "Delete login",
                                    icon: <Trash size={14} />,
                                    danger: true,
                                    onClick: () => onDelete(record),
                                },
                            ]}
                        />
                    </>
                )}
            />
        </section>
    )
}

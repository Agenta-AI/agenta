import type {ReactNode} from "react"

import {OWNER_ICON, useOwnerWord} from "@agenta/entity-ui/secret"
import {useT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import type {OwnerKind} from "@agenta/shared/types"
import {useIsPhone} from "@agenta/ui/phone"
import {PageToolbar, Segmented} from "@agenta/ui/ui"

import {SettingsPageToolbar} from "../SettingsPageShell"

import type {OwnerFilter} from "./accountOwners"

export interface ConnectionsToolbarProps {
    search: string
    onSearchChange: (next: string) => void
    searchPlaceholder: string
    /** The page's Filter menu, only where the page has filters. */
    filter?: ReactNode
    /** The owners the page holds; two or more draw the owner segment. */
    owners?: readonly OwnerKind[]
    owner?: OwnerFilter
    onOwnerChange?: (next: OwnerFilter) => void
}

/** A connections page's pinned toolbar: search, Filter, then the owner segment. */
export const ConnectionsToolbar = ({
    search,
    onSearchChange,
    searchPlaceholder,
    filter,
    owners,
    owner = "all",
    onOwnerChange,
}: ConnectionsToolbarProps) => {
    const t = useT(settingsSharedCatalog)
    const word = useOwnerWord()
    const phone = useIsPhone()
    const segment =
        owners && owners.length > 1 && onOwnerChange ? (
            <Segmented
                aria-label={t("settings.shared.owner")}
                size={phone ? "sm" : "default"}
                block={phone}
                value={owner}
                onChange={(next) => onOwnerChange(next as OwnerFilter)}
                options={[
                    {value: "all", label: t("settings.shared.ownerAll")},
                    ...owners.map((item) => {
                        const Icon = OWNER_ICON[item]
                        // The word in its own span: a bare text node reads as an icon-only option.
                        return {
                            value: item,
                            label: <span>{word(item)}</span>,
                            icon: <Icon size={14} />,
                        }
                    }),
                ]}
            />
        ) : null

    return (
        <SettingsPageToolbar>
            {phone ? (
                <div className="mb-3 flex flex-col gap-2">
                    <PageToolbar
                        className="mb-0 [&_[data-slot=input-group]]:max-w-none"
                        search={search}
                        onSearchChange={onSearchChange}
                        searchPlaceholder={searchPlaceholder}
                        actions={filter}
                    />
                    {segment}
                </div>
            ) : (
                <PageToolbar
                    search={search}
                    onSearchChange={onSearchChange}
                    searchPlaceholder={searchPlaceholder}
                    actions={filter}
                    end={segment}
                />
            )}
        </SettingsPageToolbar>
    )
}

import {useMemo} from "react"

import {OWNER_ICON, useOwnerWord} from "@agenta/entity-ui/secret"
import {useT} from "@agenta/i18n"
import settingsSharedCatalog from "@agenta/i18n/catalogs/settings.shared"
import type {OwnerKind} from "@agenta/shared/types"
import type {FilterMenuSection} from "@agenta/ui/filter-menu"
import {SquaresFour, UserCircle} from "@phosphor-icons/react"

import type {OwnerFilter} from "./accountOwners"

const ICON = 14

/**
 * The Owner row of a connections page's Filter: All, then each allowed owner narrow to wide.
 * `null` when the page holds one owner only, so there is nothing to choose.
 */
export const useOwnerFilterSection = (
    allowed: readonly OwnerKind[],
    value: OwnerFilter,
    onChange: (next: OwnerFilter) => void,
): FilterMenuSection | null => {
    const t = useT(settingsSharedCatalog)
    const word = useOwnerWord()
    return useMemo(() => {
        if (allowed.length < 2) return null
        return {
            key: "owner",
            label: t("settings.shared.owner"),
            icon: <UserCircle size={ICON} />,
            value,
            defaultValue: "all",
            options: [
                {value: "all", label: t("settings.shared.ownerAll"), icon: <SquaresFour size={ICON} />},
                ...allowed.map((owner) => {
                    const Icon = OWNER_ICON[owner]
                    return {value: owner, label: word(owner), icon: <Icon size={ICON} />}
                }),
            ],
            onChange: (next) => onChange(next as OwnerFilter),
        }
    }, [allowed, onChange, t, value, word])
}

import {useCallback, type ComponentType} from "react"

import {useT} from "@agenta/i18n"
import accountsCatalog from "@agenta/i18n/catalogs/entityUi.accounts"
import type {OwnerKind} from "@agenta/shared/types"
import {Field} from "@agenta/ui/ui"
import {Buildings, User, UsersThree, type IconProps} from "@phosphor-icons/react"

import {AccountSwitch} from "./AccountSwitch"

/** Who owns a connection, narrow to wide: the person, the project, the organization. */
export const OWNER_ORDER: readonly OwnerKind[] = ["user", "project", "organization"]

/** One glyph per owner, wherever an owner is named (the Owner field, the Owner filter). */
export const OWNER_ICON: Record<OwnerKind, ComponentType<IconProps>> = {
    user: User,
    project: UsersThree,
    organization: Buildings,
}

/** The owner's one word: Personal, Project, Organization. */
export const useOwnerWord = () => {
    const t = useT(accountsCatalog)
    return useCallback(
        (owner: OwnerKind) =>
            owner === "user"
                ? t("entityUi.accounts.ownerUser")
                : owner === "project"
                  ? t("entityUi.accounts.ownerProject")
                  : t("entityUi.accounts.ownerOrganization"),
        [t],
    )
}

export interface OwnerFieldProps<Owner extends OwnerKind> {
    value: Owner
    /** The owners this form allows, in any order; the field lists them narrow to wide. */
    owners: readonly Owner[]
    onChange: (next: Owner) => void
    /** Names the project and the organization in the sentences; absent, "this project". */
    projectName?: string
    organizationName?: string
}

/**
 * The Owner field of an add form: a segment of the allowed owners, each with its word and the
 * sentence that says who can use what is added. Every connections page asks it the same way.
 */
export function OwnerField<Owner extends OwnerKind>({
    value,
    owners,
    onChange,
    projectName,
    organizationName,
}: OwnerFieldProps<Owner>) {
    const t = useT(accountsCatalog)
    const word = useOwnerWord()
    const note = (owner: OwnerKind) =>
        owner === "user"
            ? t("entityUi.accounts.ownerUserNote")
            : owner === "project"
              ? projectName
                  ? t("entityUi.accounts.ownerProjectNote", {project: projectName})
                  : t("entityUi.accounts.ownerProjectNoteThis")
              : organizationName
                ? t("entityUi.accounts.ownerOrganizationNote", {organization: organizationName})
                : t("entityUi.accounts.ownerOrganizationNoteThis")
    const shown = OWNER_ORDER.filter((owner): owner is Owner => owners.includes(owner as Owner))

    return (
        <Field label={t("entityUi.accounts.owner")}>
            <AccountSwitch
                value={value}
                choices={shown.map((owner) => ({value: owner, label: word(owner), note: note(owner)}))}
                onChange={onChange}
                aria-label={t("entityUi.accounts.owner")}
            />
        </Field>
    )
}

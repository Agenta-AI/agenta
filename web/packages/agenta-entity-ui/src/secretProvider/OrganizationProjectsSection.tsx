/**
 * "Projects that can use it" — the one section an organization connection's drawer adds.
 *
 * Three shapes, by what the deployment allows: OSS has no choice (every project), EE without the
 * RBAC entitlement shows the choice with "Selected projects" disabled and the plan line, and EE
 * with it lets the admin pick projects. Read-only for a member, who never sees this section.
 */
import {useMemo, useState} from "react"

import type {OrganizationSecretProjects} from "@agenta/entities/secret"
import {useT} from "@agenta/i18n"
import organizationProjectsCatalog from "@agenta/i18n/catalogs/entityUi.organizationProjects"
import {
    Button,
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    Field,
    Popover,
    PopoverContent,
    PopoverTrigger,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretUpDown, Check, LockSimple, WarningCircle, X} from "@phosphor-icons/react"

import {AccountSwitch} from "../accounts/AccountSwitch"

/**
 * What the admin may do about projects in this deployment. `pending` is EE while the plan's
 * entitlements load: the choice shows, and Selected projects waits, with no plan line yet.
 */
export type OrganizationProjectChoice = "choose" | "plan" | "all" | "pending"

export interface OrganizationProjectOption {
    id: string
    name: string
}

/** What an organization connection's drawer needs to know about its organization. */
export interface OrganizationConnectionScope {
    /** The organization's name, as the copy says it. */
    name: string
    /** The organization's projects, for the picker and the names on a row. */
    projects: OrganizationProjectOption[]
    /** `choose` (EE with RBAC), `plan` (EE without it), `all` (OSS). */
    projectChoice: OrganizationProjectChoice
    /** Where "See plans" points. */
    plansHref?: string
    /** A member who is not an owner or admin: the drawer is locked, and Test stays. */
    readOnly?: boolean
}

export interface OrganizationProjectsSectionProps {
    scope: OrganizationConnectionScope
    value: OrganizationSecretProjects
    onChange: (next: OrganizationSecretProjects) => void
    /** What the saved connection allows, to warn about each project a save takes away. */
    saved?: OrganizationSecretProjects | null
}

const HEADING = "font-medium text-foreground"

/** Every project the saved choice reached and the new one does not. */
const removedProjects = (
    saved: OrganizationSecretProjects | null | undefined,
    next: OrganizationSecretProjects,
    projects: OrganizationProjectOption[],
): OrganizationProjectOption[] => {
    if (!saved || next.availability === "all_projects") return []
    const before =
        saved.availability === "all_projects"
            ? projects.map((project) => project.id)
            : saved.projectIds
    const after = new Set(next.projectIds)
    return projects.filter((project) => before.includes(project.id) && !after.has(project.id))
}

const ProjectPicker = ({
    projects,
    selected,
    onToggle,
}: {
    projects: OrganizationProjectOption[]
    selected: string[]
    onToggle: (id: string) => void
}) => {
    const t = useT(organizationProjectsCatalog)
    const [open, setOpen] = useState(false)
    const [search, setSearch] = useState("")
    return (
        <Popover
            open={open}
            onOpenChange={(next) => {
                setOpen(next)
                if (!next) setSearch("")
            }}
        >
            <PopoverTrigger asChild>
                <Button
                    type="button"
                    variant="outline"
                    role="combobox"
                    aria-expanded={open}
                    className="w-full justify-between font-normal text-muted-foreground"
                >
                    {t("entityUi.organizationProjects.pickProjects")}
                    <CaretUpDown size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
                <Command>
                    <CommandInput
                        placeholder={t("entityUi.organizationProjects.searchProjects")}
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-53">
                        <CommandEmpty>
                            {t("entityUi.organizationProjects.noProjectsMatch", {search})}
                        </CommandEmpty>
                        <CommandGroup>
                            {projects.map((project) => {
                                const checked = selected.includes(project.id)
                                return (
                                    <CommandItem
                                        key={project.id}
                                        value={`${project.name} ${project.id}`}
                                        onSelect={() => onToggle(project.id)}
                                    >
                                        <Check
                                            size={14}
                                            className={checked ? "opacity-100" : "opacity-0"}
                                        />
                                        <span className="truncate">{project.name}</span>
                                    </CommandItem>
                                )
                            })}
                        </CommandGroup>
                    </CommandList>
                </Command>
            </PopoverContent>
        </Popover>
    )
}

const OrganizationProjectsSection = ({
    scope,
    value,
    onChange,
    saved,
}: OrganizationProjectsSectionProps) => {
    const t = useT(organizationProjectsCatalog)
    const names = useMemo(
        () => new Map(scope.projects.map((project) => [project.id, project.name])),
        [scope.projects],
    )
    const removed = useMemo(
        () => removedProjects(saved, value, scope.projects),
        [saved, value, scope.projects],
    )

    if (scope.projectChoice === "all") {
        return (
            <section className="flex shrink-0 flex-col gap-1">
                <span className={HEADING}>
                    {t("entityUi.organizationProjects.projectsThatCanUse")}
                </span>
                <span className="text-muted-foreground">
                    {t("entityUi.organizationProjects.everyProjectIn", {organization: scope.name})}
                </span>
            </section>
        )
    }

    const selectedAllowed = scope.projectChoice === "choose"
    const toggle = (id: string) =>
        onChange({
            availability: "selected_projects",
            projectIds: value.projectIds.includes(id)
                ? value.projectIds.filter((projectId) => projectId !== id)
                : [...value.projectIds, id],
        })

    return (
        <section className="flex shrink-0 flex-col gap-2">
            <Field label={t("entityUi.organizationProjects.projectsThatCanUse")}>
                <AccountSwitch
                    value={value.availability}
                    choices={[
                        {
                            value: "all_projects",
                            label: t("entityUi.organizationProjects.allProjects"),
                            note: t("entityUi.organizationProjects.everyProjectInIncludingNew", {
                                organization: scope.name,
                            }),
                        },
                        {
                            value: "selected_projects",
                            label: t("entityUi.organizationProjects.selectedProjects"),
                            note: t("entityUi.organizationProjects.onlyProjectsYouPick"),
                            disabled: !selectedAllowed,
                        },
                    ]}
                    onChange={(next) =>
                        onChange({availability: next, projectIds: value.projectIds})
                    }
                    aria-label={t("entityUi.organizationProjects.projectsThatCanUse")}
                />
            </Field>

            {scope.projectChoice === "plan" ? (
                // Why "Selected projects" is greyed, and where to get it: one quiet row.
                <div className="flex items-center gap-2 rounded-md bg-secondary px-2.5 py-2 text-meta text-muted-foreground">
                    <LockSimple size={14} className="shrink-0" aria-hidden />
                    <span className="min-w-0 flex-1">
                        {t("entityUi.organizationProjects.choosingProjectsPlan")}
                    </span>
                    {scope.plansHref ? (
                        <a
                            href={scope.plansHref}
                            className="flex shrink-0 items-center gap-1 font-medium text-btn-link no-underline hover:text-btn-link-hover"
                        >
                            {t("entityUi.organizationProjects.seePlans")}
                            <ArrowSquareOut size={12} />
                        </a>
                    ) : null}
                </div>
            ) : null}

            {selectedAllowed && value.availability === "selected_projects" ? (
                <div className="flex flex-col gap-2">
                    {value.projectIds.length ? (
                        <div className="flex flex-wrap gap-1.5">
                            {value.projectIds.map((id) => (
                                <span
                                    key={id}
                                    className="flex items-center gap-1 rounded-control-sm bg-secondary py-0.5 pl-2 pr-1 text-foreground"
                                >
                                    {names.get(id) ?? id}
                                    <button
                                        type="button"
                                        aria-label={t(
                                            "entityUi.organizationProjects.removeProject",
                                            {
                                                project: names.get(id) ?? id,
                                            },
                                        )}
                                        onClick={() => toggle(id)}
                                        className="flex cursor-pointer items-center border-0 bg-transparent p-0.5 text-muted-foreground hover:text-foreground"
                                    >
                                        <X size={12} />
                                    </button>
                                </span>
                            ))}
                        </div>
                    ) : null}
                    <ProjectPicker
                        projects={scope.projects}
                        selected={value.projectIds}
                        onToggle={toggle}
                    />
                    {value.projectIds.length === 0 ? (
                        <span className="flex items-start gap-1 text-warning">
                            <WarningCircle size={14} className="mt-0.5 shrink-0" />
                            {t("entityUi.organizationProjects.noProjectUntilPick")}
                        </span>
                    ) : null}
                </div>
            ) : null}

            {removed.map((project) => (
                <span key={project.id} className="flex items-start gap-1 text-warning">
                    <WarningCircle size={14} className="mt-0.5 shrink-0" />
                    {t("entityUi.organizationProjects.projectLosesAccess", {project: project.name})}
                </span>
            ))}
        </section>
    )
}

export default OrganizationProjectsSection

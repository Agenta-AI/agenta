/**
 * "Projects that can use it" — the one section an organization connection's drawer adds (M5).
 *
 * Three shapes, by what the deployment allows: OSS has no choice (every project), EE without the
 * RBAC entitlement shows the choice with "Selected projects" disabled and the plan line, and EE
 * with it lets the admin pick projects. Read-only for a member, who never sees this section.
 *
 * Design: ~/agenta-sharing-run/M5-UI-DESIGN.md (screens 2, 4, 9).
 */
import {useMemo, useState} from "react"

import type {OrganizationSecretProjects} from "@agenta/entities/secret"
import {
    Button,
    Command,
    CommandEmpty,
    CommandGroup,
    CommandInput,
    CommandItem,
    CommandList,
    Popover,
    PopoverContent,
    PopoverTrigger,
    RadioGroup,
    RadioGroupItem,
} from "@agenta/ui/ui"
import {ArrowSquareOut, CaretUpDown, Check, WarningCircle, X} from "@phosphor-icons/react"

/** What the admin may do about projects in this deployment. */
export type OrganizationProjectChoice = "choose" | "plan" | "all"

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

const HEADING = "font-medium text-colorText"
const NOTE = "text-[11px] text-colorTextTertiary"

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
                    className="w-full justify-between font-normal text-colorTextSecondary"
                >
                    Pick projects
                    <CaretUpDown size={12} className="shrink-0" />
                </Button>
            </PopoverTrigger>
            <PopoverContent className="w-[var(--radix-popover-trigger-width)] p-1" align="start">
                <Command>
                    <CommandInput
                        placeholder="Search projects"
                        value={search}
                        onValueChange={setSearch}
                    />
                    <CommandList className="max-h-[212px]">
                        <CommandEmpty>No projects match &quot;{search}&quot;.</CommandEmpty>
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
                <span className={HEADING}>Projects that can use it</span>
                <span className="text-colorTextSecondary">Every project in {scope.name}.</span>
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
            <span className={HEADING}>Projects that can use it</span>
            <RadioGroup
                value={value.availability}
                onValueChange={(next) =>
                    onChange({
                        availability: next as OrganizationSecretProjects["availability"],
                        projectIds: value.projectIds,
                    })
                }
                className="flex flex-col gap-2"
            >
                <label className="flex cursor-pointer items-start gap-2.5">
                    <RadioGroupItem value="all_projects" className="mt-0.5" />
                    <span className="flex flex-col gap-0.5">
                        <span className="text-colorText">All projects</span>
                        <span className={NOTE}>
                            Every project in {scope.name}, including new ones.
                        </span>
                    </span>
                </label>
                <label
                    className={
                        selectedAllowed
                            ? "flex cursor-pointer items-start gap-2.5"
                            : "flex cursor-not-allowed items-start gap-2.5 opacity-60"
                    }
                >
                    <RadioGroupItem
                        value="selected_projects"
                        disabled={!selectedAllowed}
                        className="mt-0.5"
                    />
                    <span className="flex flex-col gap-0.5">
                        <span className="text-colorText">Selected projects</span>
                        <span className={NOTE}>Only the projects you pick.</span>
                    </span>
                </label>
            </RadioGroup>

            {scope.projectChoice === "plan" ? (
                <span className="flex flex-wrap items-center gap-1 text-colorTextSecondary">
                    Choosing projects is available on Business and Enterprise plans.
                    {scope.plansHref ? (
                        <a
                            href={scope.plansHref}
                            className="flex items-center gap-1 text-btn-link hover:text-btn-link-hover"
                        >
                            See plans
                            <ArrowSquareOut size={12} />
                        </a>
                    ) : null}
                </span>
            ) : null}

            {selectedAllowed && value.availability === "selected_projects" ? (
                <div className="flex flex-col gap-2 pl-6">
                    {value.projectIds.length ? (
                        <div className="flex flex-wrap gap-1.5">
                            {value.projectIds.map((id) => (
                                <span
                                    key={id}
                                    className="flex items-center gap-1 rounded-control-sm bg-colorFillTertiary py-0.5 pl-2 pr-1 text-colorText"
                                >
                                    {names.get(id) ?? id}
                                    <button
                                        type="button"
                                        aria-label={`Remove ${names.get(id) ?? id}`}
                                        onClick={() => toggle(id)}
                                        className="flex cursor-pointer items-center border-0 bg-transparent p-0.5 text-colorTextTertiary hover:text-colorText"
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
                        <span className="flex items-start gap-1 text-colorWarning">
                            <WarningCircle size={14} className="mt-0.5 shrink-0" />
                            No project can use this connection until you pick one.
                        </span>
                    ) : null}
                </div>
            ) : null}

            {removed.map((project) => (
                <span key={project.id} className="flex items-start gap-1 text-colorWarning">
                    <WarningCircle size={14} className="mt-0.5 shrink-0" />
                    {project.name} can no longer use this connection after you save. Agents in{" "}
                    {project.name} that use it will need configuration.
                </span>
            ))}
        </section>
    )
}

export default OrganizationProjectsSection

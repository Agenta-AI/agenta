import {browserProfilesQueryAtom, type BrowserProfile} from "@agenta/entities/browserProfile"
import {Checkbox, Segmented, type SegmentedValue} from "@agenta/ui/ui"
import {useAtomValue} from "jotai"

import type {BrowserAccess, BrowserAccessMode} from "./browserAccess"

const MODE_OPTIONS = [
    {value: "all", label: "All my logins"},
    {value: "selected", label: "Only these logins"},
    {value: "off", label: "Off"},
]

export interface BrowserAccessControlViewProps {
    access: BrowserAccess
    /** The user's logins; null while they load. */
    profiles: BrowserProfile[] | null
    loadFailed?: boolean
    disabled?: boolean
    onChange: (access: BrowserAccess) => void
}

export const BrowserAccessControlView = ({
    access,
    profiles,
    loadFailed = false,
    disabled,
    onChange,
}: BrowserAccessControlViewProps) => {
    const ready = (profiles ?? []).filter((profile) => profile.state === "ready")
    const checked = new Set(access.mode === "selected" ? access.profiles : [])
    const checkedCount = ready.filter((profile) => checked.has(profile.id)).length

    const setMode = (value: SegmentedValue) => {
        const mode = value as BrowserAccessMode
        onChange(mode === "selected" ? {mode, profiles: []} : {mode})
    }
    // Writes only ids still in the list, so a login the user lost drops out here.
    const toggle = (id: string, on: boolean) => {
        const next = new Set(checked)
        if (on) next.add(id)
        else next.delete(id)
        onChange({
            mode: "selected",
            profiles: ready.filter((profile) => next.has(profile.id)).map((p) => p.id),
        })
    }

    const hint = loadFailed
        ? "Could not load your browser logins."
        : access.mode === "off"
          ? "The agent gets no browser."
          : profiles === null
            ? "Loading your browser logins…"
            : ready.length === 0
              ? "You have no browser logins yet. Add one in Settings → Browser logins."
              : access.mode === "all"
                ? "The agent can use every login you have signed in to."
                : checkedCount === 0
                  ? "Pick at least one login, or the agent gets no browser."
                  : null

    return (
        <div className="flex flex-col gap-3">
            <Segmented
                block
                aria-label="Browser logins"
                options={MODE_OPTIONS}
                value={access.mode}
                disabled={disabled}
                onChange={setMode}
            />
            {access.mode === "selected" && ready.length > 0 ? (
                <div role="group" aria-label="Logins the agent can use" className="flex flex-col">
                    {ready.map((profile) => (
                        <label
                            key={profile.id}
                            className="flex cursor-pointer items-start gap-2 rounded-md px-1 py-1.5 hover:bg-colorFillTertiary"
                        >
                            <Checkbox
                                className="mt-0.5"
                                checked={checked.has(profile.id)}
                                disabled={disabled}
                                onCheckedChange={(next) => toggle(profile.id, next === true)}
                            />
                            <span className="flex min-w-0 flex-col">
                                <span className="truncate text-sm text-colorText">
                                    {profile.name}
                                </span>
                                <span className="truncate text-xs text-colorTextDescription">
                                    {profile.allowed_hosts.join(", ")}
                                </span>
                            </span>
                        </label>
                    ))}
                </div>
            ) : null}
            {hint ? (
                <span className="text-xs leading-snug text-colorTextDescription">{hint}</span>
            ) : null}
        </div>
    )
}

export const BrowserAccessControl = (props: Omit<BrowserAccessControlViewProps, "profiles">) => {
    const query = useAtomValue(browserProfilesQueryAtom)
    return (
        <BrowserAccessControlView
            {...props}
            profiles={query.data ?? null}
            loadFailed={query.isError}
        />
    )
}

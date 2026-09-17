import {useProfile} from "@agenta/entities/profile"

/**
 * 05:00–11:59 morning, 12:00–16:59 afternoon, 17:00–04:59 evening.
 *
 * The small hours read as evening rather than morning: someone up at 3am is at the end of a long
 * day, not the start of one.
 */
const greetingFor = (hour: number): string => {
    if (hour >= 5 && hour < 12) return "Good morning"
    if (hour >= 12 && hour < 17) return "Good afternoon"
    return "Good evening"
}

/**
 * The account name as a person would say it: `ashraf_chowdury99` reads as "ashraf chowdury".
 *
 * Separators become spaces and digits go, because a username is a handle and this is a greeting.
 * An email is dropped rather than cleaned — the local part of one is not a name, and greeting
 * somebody by their address reads as a mail merge.
 */
const displayName = (username: string | undefined): string | null => {
    const raw = username?.trim()
    if (!raw || raw.includes("@")) return null
    const cleaned = raw
        .replace(/[._\-+]+/g, " ")
        .replace(/\d+/g, "")
        // Anything else a handle may carry that a name would not.
        .replace(/[^\p{L}\p{M} ]+/gu, "")
        .replace(/\s+/g, " ")
        .trim()
    return cleaned || null
}

/**
 * Home's opening line: who you are and what the page is asking.
 *
 * The eyebrow is absent, not blank, until the profile resolves — a reserved empty line reads as a
 * rendering fault, and the heading is what the eye goes to either way.
 */
export const HomeGreeting = ({title}: {title: string}) => {
    const {user} = useProfile()
    const name = displayName(user?.username)

    return (
        <div className="flex flex-col gap-1.5 px-1.5">
            {name ? (
                <span className="font-mono text-[11px] uppercase leading-none tracking-[0.1em] text-muted-foreground">
                    {greetingFor(new Date().getHours())}, {name}
                </span>
            ) : null}
            <h1 className="m-0 text-[30px] font-medium leading-[1.25] tracking-[-0.015em] text-foreground">
                {title}
            </h1>
        </div>
    )
}

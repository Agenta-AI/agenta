import {useProfile} from "@agenta/entities/profile"

const greetingFor = (hour: number): string =>
    hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening"

/** The name as a person would say it — the first word of the account's name, never the email. */
const firstName = (username: string | undefined): string | null => {
    const first = username?.trim().split(/\s+/)[0]
    return first && !first.includes("@") ? first : null
}

/**
 * Home's opening line: who you are and what the page is asking.
 *
 * The eyebrow is absent, not blank, until the profile resolves — a reserved empty line reads as a
 * rendering fault, and the heading is what the eye goes to either way.
 */
export const HomeGreeting = ({title}: {title: string}) => {
    const {user} = useProfile()
    const name = firstName(user?.username)

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

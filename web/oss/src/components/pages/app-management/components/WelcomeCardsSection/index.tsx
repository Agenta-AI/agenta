import {useCallback, useMemo} from "react"

import {Typography} from "antd"
import {useAtomValue} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {isNewUserAtom} from "@/oss/lib/onboarding"

import WelcomeCard from "./assets/components/WelcomeCard"

interface WelcomeCardsSectionProps {
    onCreatePrompt: () => void
}

const WelcomeCardsSection = ({onCreatePrompt}: WelcomeCardsSectionProps) => {
    const isNewUser = useAtomValue(isNewUserAtom)
    const router = useRouter()
    const {projectURL} = useURL()

    const handleNavigate = useCallback(
        (link?: string) => {
            if (!link) return
            router.push(link)
        },
        [router],
    )

    const welcomeCards = useMemo(() => {
        const evaluationsLink = projectURL ? `${projectURL}/evaluations` : undefined

        return [
            {
                title: "Create a prompt",
                subtitle: "Start with a prompt and test it in the playground",
                onClick: onCreatePrompt,
            },
            {
                title: "Run an evaluation",
                subtitle: "Measure quality on a test set and compare versions",
                onClick: () => handleNavigate(evaluationsLink),
            },
            {
                title: "Set up tracing",
                subtitle: "Send traces from your AI app to debug and improve reliability",
                onClick: () =>
                    handleNavigate(
                        "https://agenta.ai/docs/observability/trace-with-python-sdk/setup-tracing",
                    ),
            },
            {
                title: "Explore demo project",
                subtitle: "How Agenta looks with real example data (view-only)",
                onClick: () =>
                    handleNavigate(
                        "https://agenta.ai/docs/evaluation/evaluation-from-sdk/quick-start",
                    ),
                hidden: true,
            },
        ]
    }, [projectURL, handleNavigate, onCreatePrompt])

    if (!isNewUser) return null

    return (
        <div className="flex flex-col gap-8 rounded-lg bg-[#F5F7FA] p-6">
            <div className="flex flex-col gap-2">
                <Typography className="!text-xl !font-semibold">Welcome,</Typography>
                <Typography className="!text-[32px] !font-semibold">
                    What do you want to do?
                </Typography>
            </div>
            <div className="flex gap-4">
                {welcomeCards.map((card) => (
                    <WelcomeCard
                        key={card.title}
                        title={card.title}
                        subtitle={card.subtitle}
                        onClick={card.onClick}
                        hidden={card.hidden}
                    />
                ))}
            </div>
        </div>
    )
}

export default WelcomeCardsSection

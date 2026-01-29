import {useCallback, useMemo} from "react"

import {XIcon} from "@phosphor-icons/react"
import {Button, Typography, message} from "antd"
import {useAtomValue, useSetAtom} from "jotai"
import {useRouter} from "next/router"

import useURL from "@/oss/hooks/useURL"
import {onboardingWidgetStatusAtom} from "@/oss/lib/onboarding"
import {ProjectsResponse} from "@/oss/services/project/types"
import {cacheWorkspaceOrgPair} from "@/oss/state/org/selectors/org"
import {projectsAtom} from "@/oss/state/project"

import WelcomeCard from "./assets/components/WelcomeCard"
import {welcomeCardsDismissedAtom} from "./assets/store/welcomeCards"

interface WelcomeCardsSectionProps {
    onCreatePrompt: () => void
    onSetupTracing: () => void
}

const WelcomeCardsSection = ({onCreatePrompt, onSetupTracing}: WelcomeCardsSectionProps) => {
    const onboardingWidgetStatus = useAtomValue(onboardingWidgetStatusAtom)
    const welcomeCardsDismissed = useAtomValue(welcomeCardsDismissedAtom)
    const setWelcomeCardsDismissed = useSetAtom(welcomeCardsDismissedAtom)
    const projects = useAtomValue(projectsAtom)
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
        const demoProject: ProjectsResponse | undefined = projects.find(
            (project: ProjectsResponse) => project.is_demo,
        )
        const demoWorkspaceId = demoProject?.workspace_id || demoProject?.organization_id || null
        const demoOrganizationId = demoProject?.organization_id || null
        const demoProjectLink =
            demoProject && demoWorkspaceId
                ? `/w/${encodeURIComponent(demoWorkspaceId)}/p/${encodeURIComponent(
                      demoProject.project_id,
                  )}/apps`
                : undefined

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
                onClick: onSetupTracing,
            },
            {
                title: "Explore demo project",
                subtitle: "How Agenta looks with real example data (view-only)",
                onClick: () => {
                    if (!demoProjectLink) {
                        message.error("Demo project is not available.")
                        return
                    }
                    if (demoOrganizationId) {
                        cacheWorkspaceOrgPair(demoWorkspaceId, demoOrganizationId)
                    }
                    handleNavigate(demoProjectLink)
                },
            },
        ]
    }, [projectURL, projects, handleNavigate, onCreatePrompt, onSetupTracing])

    const dismissWelcomeCards = useCallback(() => {
        setWelcomeCardsDismissed(true)
    }, [setWelcomeCardsDismissed])

    if (onboardingWidgetStatus === "completed" || welcomeCardsDismissed) return null

    return (
        <div className="flex flex-col gap-8 rounded-lg bg-[#F5F7FA] p-6">
            <div className="flex items-start justify-between gap-4">
                <div className="flex flex-col">
                    <Typography className="!text-xl !font-medium">Welcome,</Typography>
                    <Typography className="!text-[32px] !font-semibold">
                        What do you want to do?
                    </Typography>
                </div>
                <Button
                    type="text"
                    size="small"
                    icon={<XIcon size={16} className="text-[#6B7280]" />}
                    onClick={dismissWelcomeCards}
                />
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

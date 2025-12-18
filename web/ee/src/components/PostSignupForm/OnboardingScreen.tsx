import {useState} from "react"

import {ArrowLeft, Code, TreeView, Rocket} from "@phosphor-icons/react"
import {Typography, Card, Button, Space} from "antd"
import {useRouter} from "next/router"
import {createUseStyles} from "react-jss"

import {
    SetupTracingModalContent,
    useStyles as useTracingStyles,
} from "@/oss/components/pages/app-management/modals/SetupTracingModal"
import useURL from "@/oss/hooks/useURL"
import {usePostHogAg} from "@/oss/lib/helpers/analytics/hooks/usePostHogAg"
import {JSSTheme} from "@/oss/lib/Types"
import {waitForWorkspaceContext, buildPostLoginPath} from "@/oss/state/url/postLoginRedirect"

import {RunEvaluationView} from "./RunEvaluationView"

const {Title, Text} = Typography

const useStyles = createUseStyles((theme: JSSTheme) => ({
    card: {
        width: 300,
        height: 300,
        cursor: "pointer",
        transition: "all 0.2s ease",
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        alignItems: "center",
        textAlign: "center",
        border: `1px solid ${theme.colorBorder}`,
        "&:hover": {
            borderColor: theme.colorPrimary,
            boxShadow: theme.boxShadowTertiary,
        },
        "& .ant-card-body": {
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            padding: 0,
            height: "100%",
            width: "100%",
        },
    },
    iconContainer: {
        height: "50%",
        width: "100%",
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "center",
        paddingBottom: 24,
    },
    textContainer: {
        height: "50%",
        width: "100%",
        padding: "12px 24px",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
    },
    icon: {
        fontSize: 48,
        color: theme.colorText,
    },
    cardTitle: {
        fontSize: 18,
        fontWeight: 600,
        marginBottom: 8,
    },
    cardDesc: {
        color: theme.colorTextSecondary,
        fontSize: 14,
        lineHeight: 1.5,
    },
    container: {
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        minHeight: "60vh",
        gap: 40,
        padding: "40px 20px",
    },
    cardsContainer: {
        display: "flex",
        gap: 24,
        flexWrap: "wrap",
        justifyContent: "center",
    },
    backButton: {
        alignSelf: "flex-start",
        marginBottom: 20,
    },
    detailContainer: {
        width: "100%",
        maxWidth: 800,
        margin: "0 auto",
        padding: 24,
        backgroundColor: theme.colorBgContainer,
        borderRadius: theme.borderRadiusLG,
        border: `1px solid ${theme.colorBorderSecondary}`,
        marginBottom: 40,
    },
}))

type ViewState = "selection" | "trace" | "eval"

export const OnboardingScreen = () => {
    const classes = useStyles()
    const tracingClasses = useTracingStyles()
    const [view, setView] = useState<ViewState>("selection")
    const router = useRouter()
    const posthog = usePostHogAg()
    const {buildUrl} = useURL()

    const handleSelection = async (selection: "trace" | "eval" | "test_prompt") => {
        posthog?.capture?.("onboarding_selection_v1", {
            selection,
        })

        if (selection === "test_prompt") {
            try {
                const context = await waitForWorkspaceContext({
                    timeoutMs: 5000,
                    requireProjectId: true,
                    requireWorkspaceId: true,
                    requireOrgData: true,
                })
                const path = buildPostLoginPath(context)
                router.push(`${path}?create_prompt=true`)
            } catch (e) {
                console.error("Failed to resolve workspace context", e)
                // Fallback
                router.push("/apps?create_prompt=true")
            }
        } else {
            setView(selection)
        }
    }

    const handleNext = async (destination: "observability" | "evaluations") => {
        try {
            const context = await waitForWorkspaceContext({
                timeoutMs: 5000,
                requireProjectId: true,
                requireWorkspaceId: true,
                requireOrgData: true,
            })
            const path = buildPostLoginPath(context)
            // buildPostLoginPath returns /w/.../p/.../apps
            // We need to replace /apps with the destination
            const basePath = path.replace("/apps", "")
            router.push(`${basePath}/${destination}`)
        } catch (e) {
            console.error("Failed to resolve workspace context", e)
            router.push("/apps")
        }
    }

    const renderContent = () => {
        if (view === "trace") {
            return (
                <div className={classes.detailContainer}>
                    <SetupTracingModalContent
                        classes={tracingClasses}
                        onCancel={() => {}} // Not used in this context
                        isModal={false}
                        isPostLogin={true}
                    />
                    <div className="flex justify-between mt-6">
                        <Button
                            type="text"
                            icon={<ArrowLeft />}
                            onClick={() => setView("selection")}
                        >
                            Back
                        </Button>
                        <Button type="primary" onClick={() => handleNext("observability")}>
                            Next
                        </Button>
                    </div>
                </div>
            )
        }

        if (view === "eval") {
            return (
                <div className={classes.detailContainer}>
                    <RunEvaluationView />
                    <div className="flex justify-between mt-6">
                        <Button
                            type="text"
                            icon={<ArrowLeft />}
                            onClick={() => setView("selection")}
                        >
                            Back
                        </Button>
                        <Button
                            type="primary"
                            onClick={() =>
                                handleNext("evaluations?selectedEvaluation=custom_evaluation")
                            }
                        >
                            Next
                        </Button>
                    </div>
                </div>
            )
        }

        return (
            <div className={classes.container}>
                <Title level={2}>How would you like to start?</Title>

                <div className={classes.cardsContainer}>
                    <Card className={classes.card} onClick={() => handleSelection("trace")}>
                        <div className={classes.iconContainer}>
                            <TreeView className={classes.icon} />
                        </div>
                        <div className={classes.textContainer}>
                            <div className={classes.cardTitle}>Trace your application</div>
                            <div className={classes.cardDesc}>
                                Monitor and debug your application.
                            </div>
                        </div>
                    </Card>

                    <Card className={classes.card} onClick={() => handleSelection("test_prompt")}>
                        <div className={classes.iconContainer}>
                            <Rocket className={classes.icon} />
                        </div>
                        <div className={classes.textContainer}>
                            <div className={classes.cardTitle}>Create and test prompts</div>
                            <div className={classes.cardDesc}>
                                Manage and test prompts across models
                            </div>
                        </div>
                    </Card>

                    <Card className={classes.card} onClick={() => handleSelection("eval")}>
                        <div className={classes.iconContainer}>
                            <Code className={classes.icon} />
                        </div>
                        <div className={classes.textContainer}>
                            <div className={classes.cardTitle}>Run an evaluation from SDK</div>
                            <div className={classes.cardDesc}>
                                Evaluate complex AI apps to compare changes and ensure they are
                                reliable.
                            </div>
                        </div>
                    </Card>
                </div>

                <Button type="link" onClick={() => router.push("/apps")}>
                    Skip
                </Button>
            </div>
        )
    }

    return renderContent()
}

import {Dispatch, SetStateAction} from "react"

import {Code, Rocket, TreeView} from "@phosphor-icons/react"
import {Typography} from "antd"
import {createUseStyles} from "react-jss"

import {JSSTheme, ListAppsItem} from "@/oss/lib/Types"

interface GetStartedSectionProps {
    selectedOrg: any
    apps: ListAppsItem[]
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
    setIsWriteOwnAppModal: Dispatch<SetStateAction<boolean>>
    setIsSetupTracingModal: Dispatch<SetStateAction<boolean>>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    container: {
        display: "grid",
        gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
        gap: 16,
    },
    card: {
        border: `1px solid ${theme.colorBorderSecondary}`,
        borderRadius: theme.borderRadiusLG,
        padding: 24,
        cursor: "pointer",
        transition: "all 0.2s ease",
        backgroundColor: theme.colorBgContainer,
        display: "flex",
        flexDirection: "column",
        gap: 16,
        height: "100%",
        "&:hover": {
            borderColor: theme.colorPrimary,
            transform: "translateY(-2px)",
            boxShadow: theme.boxShadowTertiary,
        },
    },
    iconWrapper: {
        width: 48,
        height: 48,
        borderRadius: 12,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        backgroundColor: theme.controlItemBgActive,
        color: theme.colorPrimary,
        fontSize: 24,
    },
    cardTitle: {
        fontSize: 16,
        fontWeight: 600,
        color: theme.colorText,
    },
    cardDesc: {
        fontSize: 14,
        color: theme.colorTextSecondary,
        lineHeight: 1.5,
    },
}))

const {Title, Text} = Typography

const GetStartedSection = ({
    selectedOrg,
    apps,
    setIsAddAppFromTemplatedModal,
    setIsMaxAppModalOpen,
    setIsWriteOwnAppModal,
    setIsSetupTracingModal,
}: GetStartedSectionProps) => {
    const classes = useStyles()

    return (
        <div className="my-8 flex flex-col gap-6">
            <Title level={3} className="!m-0">Get Started</Title>

            <div className={classes.container}>
                <div
                    className={classes.card}
                    onClick={() => {
                        setIsAddAppFromTemplatedModal(true)
                    }}
                >
                    <div className={classes.iconWrapper}>
                        <Rocket />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className={classes.cardTitle}>Create New Prompt</div>
                        </div>
                        <div className={classes.cardDesc}>
                            Create new prompt and edit it in the playground
                        </div>
                    </div>
                </div>

                <div
                    className={classes.card}
                    onClick={() => setIsSetupTracingModal(true)}
                >
                    <div className={classes.iconWrapper}>
                        <TreeView />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className={classes.cardTitle}>Set Up Tracing</div>
                        </div>
                        <div className={classes.cardDesc}>
                            Start instrumenting your LLM application
                        </div>
                    </div>
                </div>

                <div
                    className={classes.card}
                    onClick={() => setIsWriteOwnAppModal(true)}
                >
                    <div className={classes.iconWrapper}>
                        <Code />
                    </div>
                    <div>
                        <div className="flex items-center gap-2 mb-1">
                            <div className={classes.cardTitle}>Create Custom Workflow</div>
                        </div>
                        <div className={classes.cardDesc}>
                            Create a playground for your custom workflows
                        </div>
                    </div>
                </div>
            </div>
        </div>
    )
}

export default GetStartedSection

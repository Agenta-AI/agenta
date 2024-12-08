import {isDemo} from "@/lib/helpers/utils"
import {JSSTheme, ListAppsItem} from "@/lib/Types"
import {Code, Info, Rocket, TreeView} from "@phosphor-icons/react"
import {Card, Tooltip, Typography} from "antd"
import React, {Dispatch, SetStateAction} from "react"
import {createUseStyles} from "react-jss"

interface GetStartedSectionProps {
    selectedOrg: any
    apps: ListAppsItem[]
    setIsMaxAppModalOpen: (value: SetStateAction<boolean>) => void
    setIsAddAppFromTemplatedModal: (value: SetStateAction<boolean>) => void
    setIsWriteOwnAppModal: Dispatch<SetStateAction<boolean>>
    setIsSetupTracingModal: Dispatch<SetStateAction<boolean>>
}

const useStyles = createUseStyles((theme: JSSTheme) => ({
    getStartedCard: {
        width: 226,
        cursor: "pointer",
        transition: "all 0.025s ease-in",
        "& .ant-card-head": {
            padding: 12,
            borderBottom: "none",
            minHeight: "auto",
            marginBottom: "auto",
            color: "inherit",
            "& .ant-card-head-title": {
                display: "flex",
            },
        },
        "& .ant-card-body": {
            padding: 12,
            "& span.ant-typography": {
                textOverflow: "ellipsis",
                fontSize: theme.fontSizeLG,
                fontWeight: theme.fontWeightMedium,
                lineHeight: theme.lineHeightLG,
                color: "inherit",
            },
        },
        "&:hover": {
            boxShadow: theme.boxShadowTertiary,
        },
        "&:first-of-type": {
            backgroundColor: theme.colorPrimary,
            color: `${theme.colorWhite} !important`,
            "&:hover": {
                backgroundColor: theme.colorPrimaryHover,
            },
        },
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
        <div className="my-6 flex flex-col gap-4">
            <Title level={2}>Get Started</Title>

            <div className="flex gap-4">
                <Card
                    title={<Rocket size={24} />}
                    className={classes.getStartedCard}
                    onClick={() => {
                        if (isDemo() && selectedOrg?.is_paying == false && apps.length > 2) {
                            setIsMaxAppModalOpen(true)
                        } else {
                            setIsAddAppFromTemplatedModal(true)
                        }
                    }}
                    data-cy="create-from-template"
                >
                    <div className="flex items-center justify-between">
                        <Text>Create New Prompt</Text>

                        <Tooltip title="Create new prompt and edit it in the playground">
                            <Info size={16} />
                        </Tooltip>
                    </div>
                </Card>

                <Card
                    title={<TreeView size={24} />}
                    className={classes.getStartedCard}
                    onClick={() => setIsSetupTracingModal(true)}
                >
                    <div className="flex items-center justify-between">
                        <Text>Set Up Tracing</Text>

                        <Tooltip title="Start instrumenting your LLM application">
                            <Info size={16} />
                        </Tooltip>
                    </div>
                </Card>

                <Card
                    title={<Code size={24} />}
                    className={classes.getStartedCard}
                    onClick={() => setIsWriteOwnAppModal(true)}
                >
                    <div className="flex items-center justify-between">
                        <Text>Create Custom Workflow</Text>

                        <Tooltip title="Create a playground for your custom workflows (RAG, agents..)">
                            <Info size={16} />
                        </Tooltip>
                    </div>
                </Card>
            </div>
        </div>
    )
}

export default GetStartedSection

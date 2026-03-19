import {useMemo, useState} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {workflowMolecule} from "@agenta/entities/workflow"
import {CloseOutlined, MoreOutlined, PythonOutlined} from "@ant-design/icons"
import {
    ArrowRight,
    ClockClockwise,
    CloudWarning,
    FileCode,
    FileTs,
    Rocket,
    Swap,
} from "@phosphor-icons/react"
import {Button, Drawer, DrawerProps, Dropdown, Space, Tabs, Tooltip, Typography} from "antd"
import clsx from "clsx"
import {useAtomValue} from "jotai"
import dynamic from "next/dynamic"
import {useRouter} from "next/router"

import fetchConfigcURLCode from "@/oss/code_snippets/endpoints/fetch_config/curl"
import fetchConfigpythonCode from "@/oss/code_snippets/endpoints/fetch_config/python"
import fetchConfigtsCode from "@/oss/code_snippets/endpoints/fetch_config/typescript"
import invokeLlmAppcURLCode from "@/oss/code_snippets/endpoints/invoke_llm_app/curl"
import invokeLlmApppythonCode from "@/oss/code_snippets/endpoints/invoke_llm_app/python"
import invokeLlmApptsCode from "@/oss/code_snippets/endpoints/invoke_llm_app/typescript"
import VariantPopover from "@/oss/components/pages/overview/variants/VariantPopover"
import {usePlaygroundNavigation} from "@/oss/hooks/usePlaygroundNavigation"
import {isDemo} from "@/oss/lib/helpers/utils"
import type {Parameter} from "@/oss/lib/Types"
import {createParams} from "@/oss/pages/w/[workspace_id]/p/[project_id]/apps/[app_id]/endpoints"
import {currentAppAtom} from "@/oss/state/app"

import LanguageCodeBlock from "./assets/LanguageCodeBlock"
import type {DeploymentDrawerProps} from "./types"

const DeploymentHistoryModal = dynamic(
    () => import("@/oss/components/pages/overview/deployments/DeploymentHistoryModal"),
)

const {Title, Text} = Typography

const DeploymentDrawer = ({
    variants,
    selectedEnvironment,
    loadEnvironments,
    setQueryEnv,
    setOpenChangeVariantModal,
    ...props
}: DeploymentDrawerProps & DrawerProps) => {
    const router = useRouter()
    const appId = router.query.app_id as string
    const currentApp = useAtomValue(currentAppAtom)
    const [selectedLang, setSelectedLang] = useState("python")
    const {goToPlayground} = usePlaygroundNavigation()
    const variant = useMemo(() => {
        return (
            (variants || []).find(
                (variant) => variant?.variantId === selectedEnvironment?.deployedVariantId,
            ) || null
        )
    }, [variants, selectedEnvironment.deployedVariantId])
    const [isHistoryModalOpen, setIsHistoryModalOpen] = useState(false)

    const entityEnv = useAtomValue(
        useMemo(
            () => environmentMolecule.atoms.bySlug(selectedEnvironment?.name ?? ""),
            [selectedEnvironment?.name],
        ),
    )

    const deployedRevisionId = selectedEnvironment?.deployedRevisionId || ""
    const uri = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.deploymentUrl(deployedRevisionId),
            [deployedRevisionId],
        ),
    )
    const inputPorts = useAtomValue(
        useMemo(
            () => workflowMolecule.selectors.inputPorts(deployedRevisionId),
            [deployedRevisionId],
        ),
    )

    const params = useMemo(() => {
        const inputKeys = (inputPorts || []).map((p) => p.key as string)
        const synthesized: Parameter[] = inputKeys.map((name) => ({
            name,
            type: "string",
            input: name === "messages",
            required: true,
        }))

        const built = createParams(
            synthesized,
            selectedEnvironment?.name || "none",
            "add_a_value",
            currentApp,
        )
        return built
    }, [inputPorts, currentApp, selectedEnvironment?.name])

    const invokeLlmUrl = (uri && uri.trim()) || ""

    const invokeLlmAppCodeSnippet: Record<string, string> = {
        python: invokeLlmApppythonCode(invokeLlmUrl, params, ""),
        bash: invokeLlmAppcURLCode(invokeLlmUrl, params, ""),
        typescript: invokeLlmApptsCode(invokeLlmUrl, params, ""),
    }

    const fetchConfigCodeSnippet: Record<string, string> = {
        python: fetchConfigpythonCode(
            (currentApp?.name ?? currentApp?.slug)!,
            selectedEnvironment?.name!,
            "",
        ),
        bash: fetchConfigcURLCode(
            (currentApp?.name ?? currentApp?.slug)!,
            selectedEnvironment?.name!,
            "",
        ),
        typescript: fetchConfigtsCode(
            (currentApp?.name ?? currentApp?.slug)!,
            selectedEnvironment?.name!,
            "",
        ),
    }

    const handleOpenSelectDeployVariantModal = () => {
        setOpenChangeVariantModal(true)
        setQueryEnv("")
    }

    return (
        <>
            <Drawer
                width={720}
                {...props}
                destroyOnHidden
                closeIcon={null}
                title={
                    <Space className="flex justify-between w-full [&_h1.ant-typography]:text-lg [&_h1.ant-typography]:font-medium [&_h1.ant-typography]:!mb-0">
                        <Space className="gap-3">
                            <Button
                                onClick={() => props.onClose?.({} as any)}
                                type="text"
                                icon={<CloseOutlined />}
                            />
                            <Title>{selectedEnvironment?.name} environment</Title>
                        </Space>

                        {selectedEnvironment.deployedVariantName && (
                            <Space>
                                <Tooltip
                                    title={isDemo() ? "" : "History available in Cloud/EE only"}
                                >
                                    <Button
                                        size="small"
                                        className="flex items-center gap-2"
                                        disabled={!isDemo()}
                                        onClick={() => setIsHistoryModalOpen(true)}
                                    >
                                        <ClockClockwise size={16} />
                                        View history
                                    </Button>
                                </Tooltip>
                                <Dropdown
                                    trigger={["hover"]}
                                    menu={{
                                        items: [
                                            {
                                                key: "change_variant",
                                                label: "Change Variant",
                                                icon: <Swap size={16} />,
                                                onClick: handleOpenSelectDeployVariantModal,
                                            },
                                            {
                                                key: "open_playground",
                                                label: "Open in playground",
                                                icon: <Rocket size={16} />,
                                                onClick: () =>
                                                    goToPlayground(
                                                        selectedEnvironment.deployedRevisionId ??
                                                            undefined,
                                                    ),
                                            },
                                        ],
                                    }}
                                >
                                    <Button type="text" icon={<MoreOutlined />} size="small" />
                                </Dropdown>
                            </Space>
                        )}
                    </Space>
                }
            >
                {selectedEnvironment.deployedVariantName ? (
                    <div className="flex flex-col">
                        <div className="flex justify-between">
                            <Text className="font-[500]">Variant Deployed</Text>

                            {variant && (
                                <VariantPopover
                                    env={selectedEnvironment}
                                    selectedDeployedVariant={variant as any}
                                />
                            )}
                        </div>

                        <div
                            className={clsx([
                                "[&_.ant-tabs-nav]:sticky",
                                "[&_.ant-tabs-nav]:-top-[25px]",
                                "[&_.ant-tabs-nav]:bg-white",
                                "[&_.ant-tabs-nav]:z-[1]",
                            ])}
                        >
                            <Tabs
                                destroyOnHidden
                                defaultActiveKey={selectedLang}
                                items={[
                                    {
                                        key: "python",
                                        label: "Python",
                                        children: (
                                            <LanguageCodeBlock
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                                selectedLang={selectedLang}
                                                handleOpenSelectDeployVariantModal={
                                                    handleOpenSelectDeployVariantModal
                                                }
                                                invokeLlmUrl={invokeLlmUrl}
                                                showDeployOverlay={false}
                                            />
                                        ),
                                        icon: <PythonOutlined />,
                                    },
                                    {
                                        key: "typescript",
                                        label: "TypeScript",
                                        children: (
                                            <LanguageCodeBlock
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                                selectedLang={selectedLang}
                                                handleOpenSelectDeployVariantModal={
                                                    handleOpenSelectDeployVariantModal
                                                }
                                                invokeLlmUrl={invokeLlmUrl}
                                                showDeployOverlay={false}
                                            />
                                        ),
                                        icon: <FileTs size={14} />,
                                    },
                                    {
                                        key: "bash",
                                        label: "cURL",
                                        children: (
                                            <LanguageCodeBlock
                                                fetchConfigCodeSnippet={fetchConfigCodeSnippet}
                                                invokeLlmAppCodeSnippet={invokeLlmAppCodeSnippet}
                                                selectedLang={selectedLang}
                                                handleOpenSelectDeployVariantModal={
                                                    handleOpenSelectDeployVariantModal
                                                }
                                                invokeLlmUrl={invokeLlmUrl}
                                                showDeployOverlay={false}
                                            />
                                        ),
                                        icon: <FileCode size={14} />,
                                    },
                                ]}
                                onChange={setSelectedLang}
                            />
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-4 py-20">
                        <CloudWarning size={40} />

                        <Typography.Text>
                            No deployment has been done on {selectedEnvironment.name} environment
                        </Typography.Text>

                        <Button
                            className="flex items-center gap-2"
                            onClick={handleOpenSelectDeployVariantModal}
                        >
                            Deploy now <ArrowRight size={14} />
                        </Button>
                    </div>
                )}
            </Drawer>

            <DeploymentHistoryModal
                open={isHistoryModalOpen}
                onCancel={() => setIsHistoryModalOpen(false)}
                setIsHistoryModalOpen={setIsHistoryModalOpen}
                environmentId={entityEnv?.id ?? ""}
                environmentName={selectedEnvironment.name}
                environmentVariantId={entityEnv?.variant_id ?? null}
                currentAppRevisionId={selectedEnvironment.deployedRevisionId ?? null}
                appId={appId}
                appSlug={currentApp?.slug ?? currentApp?.name ?? null}
            />
        </>
    )
}

export default DeploymentDrawer

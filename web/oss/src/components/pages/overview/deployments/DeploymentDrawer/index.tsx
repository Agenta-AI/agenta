import {useMemo, useState} from "react"

import {environmentMolecule} from "@agenta/entities/environment"
import {workflowMolecule} from "@agenta/entities/workflow"
import {Button} from "@agenta/primitive-ui/components/button"
import {
    DropdownMenu,
    DropdownMenuContent,
    DropdownMenuItem,
    DropdownMenuTrigger,
} from "@agenta/primitive-ui/components/dropdown-menu"
import {Tabs, TabsContent, TabsList, TabsTrigger} from "@agenta/primitive-ui/components/tabs"
import {Tooltip, TooltipTrigger, TooltipContent} from "@agenta/primitive-ui/components/tooltip"
import {EnhancedDrawer} from "@agenta/ui/drawer"
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
import {DrawerProps, Space} from "antd"
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
    const isChat = useAtomValue(
        useMemo(() => workflowMolecule.selectors.isChat(deployedRevisionId), [deployedRevisionId]),
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
            selectedEnvironment?.slug || "none",
            "add_a_value",
            currentApp,
            {flags: {is_chat: isChat}},
        )
        return built
    }, [inputPorts, currentApp, selectedEnvironment?.slug, isChat])

    const invokeLlmUrl = (uri && uri.trim()) || ""

    const invokeLlmAppCodeSnippet: Record<string, string> = {
        python: invokeLlmApppythonCode(invokeLlmUrl, params, ""),
        bash: invokeLlmAppcURLCode(invokeLlmUrl, params, ""),
        typescript: invokeLlmApptsCode(invokeLlmUrl, params, ""),
    }

    const fetchConfigCodeSnippet: Record<string, string> = {
        python: fetchConfigpythonCode(currentApp?.slug ?? "", selectedEnvironment?.slug!, ""),
        bash: fetchConfigcURLCode(currentApp?.slug ?? "", selectedEnvironment?.slug!, ""),
        typescript: fetchConfigtsCode(currentApp?.slug ?? "", selectedEnvironment?.slug!, ""),
    }

    const handleOpenSelectDeployVariantModal = () => {
        setOpenChangeVariantModal(true)
        setQueryEnv("")
    }

    return (
        <>
            <EnhancedDrawer
                width={720}
                {...props}
                destroyOnHidden
                closeIcon={null}
                title={
                    <Space className="flex justify-between w-full">
                        <Space className="gap-3">
                            <Button
                                onClick={() => props.onClose?.({} as any)}
                                variant="ghost"
                                size="icon"
                            >
                                {<CloseOutlined />}
                            </Button>
                            <h2 className="mb-0 text-lg font-medium">
                                {selectedEnvironment?.name} environment
                            </h2>
                        </Space>

                        {selectedEnvironment.deployedVariantName && (
                            <Space>
                                <Tooltip>
                                    <TooltipTrigger
                                        render={
                                            <Button
                                                className="flex items-center gap-2"
                                                disabled={!isDemo()}
                                                onClick={() => setIsHistoryModalOpen(true)}
                                                variant="outline"
                                                size="sm"
                                            >
                                                <ClockClockwise size={16} />
                                                View history
                                            </Button>
                                        }
                                    />
                                    <TooltipContent>
                                        {isDemo() ? "" : "History available in Cloud/EE only"}
                                    </TooltipContent>
                                </Tooltip>
                                <DropdownMenu>
                                    <DropdownMenuTrigger className="inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent size-7 text-sm font-medium transition-all outline-none select-none hover:bg-muted hover:text-foreground disabled:pointer-events-none disabled:opacity-50">
                                        {<MoreOutlined />}
                                    </DropdownMenuTrigger>
                                    <DropdownMenuContent align="end" sideOffset={4}>
                                        <DropdownMenuItem
                                            onClick={handleOpenSelectDeployVariantModal}
                                        >
                                            <Swap size={16} />
                                            Change Variant
                                        </DropdownMenuItem>
                                        <DropdownMenuItem
                                            onClick={() =>
                                                goToPlayground(
                                                    selectedEnvironment.deployedRevisionId ??
                                                        undefined,
                                                )
                                            }
                                        >
                                            <Rocket size={16} />
                                            Open in playground
                                        </DropdownMenuItem>
                                    </DropdownMenuContent>
                                </DropdownMenu>
                            </Space>
                        )}
                    </Space>
                }
            >
                {selectedEnvironment.deployedVariantName ? (
                    <div className="flex flex-col">
                        <div className="flex justify-between">
                            <span className="font-[500]">Variant Deployed</span>

                            {variant && (
                                <VariantPopover
                                    env={selectedEnvironment}
                                    selectedDeployedVariant={variant as any}
                                />
                            )}
                        </div>

                        <div>
                            <Tabs
                                value={selectedLang}
                                onValueChange={(key) => {
                                    if (key !== null) setSelectedLang(String(key))
                                }}
                            >
                                <TabsList
                                    variant="line"
                                    className="sticky -top-[25px] z-[1] bg-[var(--ag-c-FFFFFF)]"
                                >
                                    <TabsTrigger value="python" className="gap-1.5 px-3">
                                        <PythonOutlined />
                                        Python
                                    </TabsTrigger>
                                    <TabsTrigger value="typescript" className="gap-1.5 px-3">
                                        <FileTs size={14} />
                                        TypeScript
                                    </TabsTrigger>
                                    <TabsTrigger value="bash" className="gap-1.5 px-3">
                                        <FileCode size={14} />
                                        cURL
                                    </TabsTrigger>
                                </TabsList>
                                {["python", "typescript", "bash"].map((lang) => (
                                    <TabsContent key={lang} value={lang}>
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
                                    </TabsContent>
                                ))}
                            </Tabs>
                        </div>
                    </div>
                ) : (
                    <div className="flex flex-col items-center justify-center gap-4 py-20">
                        <CloudWarning size={40} />

                        <span>
                            No deployment has been done on {selectedEnvironment.name} environment
                        </span>

                        <Button
                            className="flex items-center gap-2"
                            onClick={handleOpenSelectDeployVariantModal}
                            variant="outline"
                        >
                            Deploy now <ArrowRight size={14} />
                        </Button>
                    </div>
                )}
            </EnhancedDrawer>

            <DeploymentHistoryModal
                open={isHistoryModalOpen}
                onCancel={() => setIsHistoryModalOpen(false)}
                setIsHistoryModalOpen={setIsHistoryModalOpen}
                environmentId={entityEnv?.id ?? ""}
                environmentName={selectedEnvironment.name}
                environmentVariantId={entityEnv?.variant_id ?? null}
                currentAppRevisionId={selectedEnvironment.deployedRevisionId ?? null}
                appId={appId}
                appSlug={currentApp?.slug ?? null}
            />
        </>
    )
}

export default DeploymentDrawer

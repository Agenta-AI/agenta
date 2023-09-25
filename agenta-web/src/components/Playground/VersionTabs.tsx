// VersionTabs.tsx

import React, {useState, useEffect, useRef} from "react"
import {Tabs, message} from "antd"
import ViewNavigation from "./ViewNavigation"
import VariantRemovalWarningModal from "./VariantRemovalWarningModal"
import NewVariantModal from "./NewVariantModal"
import router, {useRouter} from "next/router"
import {fetchEnvironments, fetchVariants, removeVariant, saveNewVariant} from "@/lib/services/api"
import {Variant, PlaygroundTabsItem, Environment, Parameter} from "@/lib/Types"

import {SyncOutlined} from "@ant-design/icons"
import useStateCallback from "@/hooks/useStateCallback"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import {useVariants} from "@/lib/hooks/useVariant"

async function addTab(
    setActiveKey: any,
    setVariants: any,
    variants: Variant[],
    templateVariantName: string,
    newVariantName: string,
    appName: string,
    optParams: React.MutableRefObject<Parameter[]>,
    mssgModal: (mssg: string) => void,
) {
    // Find the template variant
    const templateVariant = variants.find((variant) => variant.variantName === templateVariantName)

    // Check if the template variant exists
    if (!templateVariant) {
        message.error("Template variant not found. Please choose a valid variant.")
        return
    }

    // Get TemplateVariant and Variant Name
    const newTemplateVariantName = templateVariant.templateVariantName
        ? templateVariant.templateVariantName
        : templateVariantName
    const updateNewVariantName = `${newTemplateVariantName}.${newVariantName}`

    // Check if variant with the same name already exists
    const existingVariant = variants.find((variant) => variant.variantName === updateNewVariantName)

    // Check if the variant exists
    if (existingVariant) {
        message.error("A variant with this name already exists. Please choose a different name.")
        return
    }

    const newVariant: Variant = {
        variantName: updateNewVariantName,
        templateVariantName: newTemplateVariantName,
        persistent: false,
        parameters: templateVariant.parameters,
    }

    await saveNewVariant(appName, newVariant, optParams.current)
    setVariants((prevState: any) => [...prevState, newVariant])
    setActiveKey(updateNewVariantName)
    mssgModal("Variant added successfully!")
}

async function removeTab(
    appName: string,
    setActiveKey: any,
    setVariants: any,
    variants: Variant[],
    activeKey: string,
    mssgModal: (mssg: string) => void,
) {
    const newVariants = variants.filter((variant) => variant.variantName !== activeKey)
    if (newVariants.length < 1) {
        router.push(`/apps`)
    }
    let newActiveKey = ""
    if (newVariants.length > 0) {
        newActiveKey = newVariants[newVariants.length - 1].variantName
    }
    await removeVariant(appName, activeKey)
    setVariants(newVariants)
    setActiveKey(newActiveKey)
    mssgModal("Variant removed successfully!")
}

const VersionTabs: React.FC = () => {
    const router = useRouter()
    const appName = router.query.app_name as unknown as string
    const [templateVariantName, setTemplateVariantName] = useState("") // We use this to save the template variant name when the user creates a new variant
    const [activeKey, setActiveKey] = useState("1")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [variants, setVariants] = useState<Variant[]>([]) // These are the variants that exist in the backend
    const [isLoading, setIsLoading] = useState(true)
    const [isError, setIsError] = useState(false)
    const [newVariantName, setNewVariantName] = useState("") // This is the name of the new variant that the user is creating
    const [isWarningModalOpen1, setRemovalWarningModalOpen1] = useState(false)
    const [isWarningModalOpen2, setRemovalWarningModalOpen2] = useState(false)
    const [removalVariantName, setRemovalVariantName] = useState<string | null>(null)
    const [isDeleteLoading, setIsDeleteLoading] = useState(false)
    const [messageApi, contextHolder] = message.useMessage()
    const [unSavedChanges, setUnSavedChanges] = useStateCallback(false)
    const variantData = useVariants(appName, variants)
    const data = useRef<{newOptParams: Parameter[]; persist: boolean; updateVariant: boolean}[]>([])
    const optParams = useRef<Parameter[]>([])

    useBlockNavigation(unSavedChanges, {
        title: "Unsaved changes",
        message:
            "You have unsaved changes in your playground. Do you want to save these changes before leaving the page?",
        okText: "Save",
        onOk: async () => {
            await saveAllVariantChanges()
            return true
        },
        cancelText: "Proceed without saving",
    })

    useEffect(() => {
        if (unSavedChanges) {
            setUnSavedChanges(true)
        }
    }, [variantData])

    const saveAllVariantChanges = async () => {
        await Promise.all(
            data.current.map(({newOptParams, persist, updateVariant}, index) => {
                return variantData[index]?.saveOptParams(newOptParams, true, true)
            }),
        )
    }

    const fetchData = async () => {
        try {
            const backendVariants = await fetchVariants(appName)
            if (backendVariants.length > 0) {
                setVariants(backendVariants)
                setActiveKey(backendVariants[0].variantName)
            }

            setIsLoading(false)
        } catch (error) {
            setIsError(true)
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [appName])

    // Load environments
    const [environments, setEnvironments] = useState<Environment[]>([])
    const loadEnvironments = async () => {
        const response: Environment[] = await fetchEnvironments(appName)
        if (response.length === 0) return

        setEnvironments(
            response.map((env) => ({
                name: env.name,
                deployed_app_variant: env.deployed_app_variant,
            })),
        )
    }
    useEffect(() => {
        if (!appName) return
        loadEnvironments()
    }, [appName, activeKey])

    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variants...</div>

    const handleRemove = () => {
        if (removalVariantName) {
            removeTab(appName, setActiveKey, setVariants, variants, removalVariantName, mssgModal)
        }
        setRemovalWarningModalOpen1(false)
    }
    const handleBackendRemove = async () => {
        if (removalVariantName) {
            setIsDeleteLoading(true)
            removeTab(appName, setActiveKey, setVariants, variants, removalVariantName, mssgModal)
            setIsDeleteLoading(false)
        }
        setRemovalWarningModalOpen1(false)
    }

    const handleCancel1 = () => setRemovalWarningModalOpen1(false)
    const handleCancel2 = () => setRemovalWarningModalOpen2(false)

    /**
     * Called when the variant is saved for the first time to the backend
     * after this point, the variant cannot be removed from the tab menu
     * but only through the button
     * @param variantName
     */
    function handlePersistVariant(variantName: string) {
        setVariants((prevVariants) => {
            return prevVariants.map((variant) => {
                if (variant.variantName === variantName) {
                    return {...variant, persistent: true}
                }
                return variant
            })
        })
    }
    const mssgModal = (mssg: string) => {
        messageApi.open({
            type: "success",
            content: mssg,
        })
    }

    const handleOnOptParamsChange = (
        newOptParams: Parameter[],
        persist: boolean,
        updateVariant: boolean,
        index: number,
    ) => {
        data.current[index] = {newOptParams, persist, updateVariant}
        optParams.current = newOptParams
    }

    // Map the variants array to create the items array conforming to the Tab interface
    const tabItems: PlaygroundTabsItem[] = variants.map((variant, index) => ({
        key: variant.variantName,
        label: `Variant ${variant.variantName}`,
        children: (
            <ViewNavigation
                variant={variant}
                handlePersistVariant={handlePersistVariant}
                setRemovalVariantName={setRemovalVariantName}
                setRemovalWarningModalOpen={setRemovalWarningModalOpen2}
                isDeleteLoading={isDeleteLoading && removalVariantName === variant.variantName}
                environments={environments}
                setUnSavedChanges={setUnSavedChanges}
                onOptParamsChange={(...args) => handleOnOptParamsChange(...args, index)}
                saveAllVariantChanges={saveAllVariantChanges}
            />
        ),
        closable: !variant.persistent,
    }))

    return (
        <div>
            {contextHolder}
            <div style={{position: "relative"}}>
                <div style={{position: "absolute", zIndex: 1000, right: 5, top: 10}}>
                    <SyncOutlined
                        spin={isLoading}
                        style={{color: "#1677ff", fontSize: "17px"}}
                        onClick={() => {
                            setIsLoading(true)
                            fetchData()
                        }}
                    />
                </div>
                <Tabs
                    type="editable-card"
                    activeKey={activeKey}
                    onChange={setActiveKey}
                    onEdit={(targetKey, action) => {
                        if (action === "add") {
                            setIsModalOpen(true)
                        } else if (action === "remove") {
                            setRemovalVariantName(targetKey as string)
                            setRemovalWarningModalOpen1(true)
                        }
                    }}
                    items={tabItems}
                />
            </div>

            <NewVariantModal
                isModalOpen={isModalOpen}
                setIsModalOpen={setIsModalOpen}
                addTab={() =>
                    addTab(
                        setActiveKey,
                        setVariants,
                        variants,
                        templateVariantName,
                        newVariantName,
                        appName,
                        optParams,
                        mssgModal,
                    )
                }
                variants={variants}
                setNewVariantName={setNewVariantName}
                newVariantName={newVariantName}
                setTemplateVariantName={setTemplateVariantName}
            />
            <VariantRemovalWarningModal
                isModalOpen={isWarningModalOpen1}
                setIsModalOpen={setRemovalWarningModalOpen1}
                handleRemove={handleRemove}
                handleCancel={handleCancel1}
            />
            <VariantRemovalWarningModal
                isModalOpen={isWarningModalOpen2}
                setIsModalOpen={setRemovalWarningModalOpen2}
                handleRemove={handleBackendRemove}
                handleCancel={handleCancel2}
            />
        </div>
    )
}

export default VersionTabs

import React, {useState, useEffect, useRef, useCallback} from "react"
import {Tabs, message} from "antd"
import ViewNavigation from "./ViewNavigation"
import NewVariantModal from "./NewVariantModal"
import {fetchEnvironments, fetchVariants} from "@/lib/services/api"
import {Variant, PlaygroundTabsItem, Environment} from "@/lib/Types"
import {SyncOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import {useQueryParam} from "@/hooks/useQuery"
import AlertPopup from "../AlertPopup/AlertPopup"
import TestContextProvider from "./TestsetContextProvider"
import useBlockNavigation from "@/hooks/useBlockNavigation"

const Playground: React.FC = () => {
    const router = useRouter()
    const appId = router.query.app_id as string
    const [templateVariantName, setTemplateVariantName] = useState("") // We use this to save the template variant name when the user creates a new variant
    const [activeKey, setActiveKey] = useQueryParam("variant")
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [variants, setVariants] = useState<Variant[]>([]) // These are the variants that exist in the backend
    const [isLoading, setIsLoading] = useState(true)
    const [isError, setIsError] = useState(false)
    const [newVariantName, setNewVariantName] = useState("") // This is the name of the new variant that the user is creating
    const [messageApi, contextHolder] = message.useMessage()
    const [unsavedVariants, setUnsavedVariants] = useState<{[name: string]: boolean}>({})
    const variantHelpers = useRef<{[name: string]: {save: Function; delete: Function}}>({})

    const addTab = () => {
        // Find the template variant
        const templateVariant = variants.find(
            (variant) => variant.variantName === templateVariantName,
        )

        // Check if the template variant exists
        if (!templateVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        // Get TemplateVariant and Variant Name
        const newTemplateVariantName = templateVariant.templateVariantName
            ? templateVariant.templateVariantName
            : templateVariantName
        const updateNewVariantName = `${templateVariant.baseName}.${newVariantName}`

        // Check if variant with the same name already exists
        const existingVariant = variants.find(
            (variant) => variant.variantName === updateNewVariantName,
        )

        // Check if the variant exists
        if (existingVariant) {
            message.error(
                "A variant with this name already exists. Please choose a different name.",
            )
            return
        }

        const newVariant: Partial<Variant> = {
            variantName: updateNewVariantName,
            templateVariantName: newTemplateVariantName,
            previousVariantName: templateVariant.variantName,
            persistent: false,
            parameters: templateVariant.parameters,
            baseId: templateVariant.baseId,
            baseName: templateVariant.baseName || newTemplateVariantName,
            configName: newVariantName,
            configId: templateVariant.configId,
        }

        setVariants((prevState: any) => [...prevState, newVariant])
        setActiveKey(updateNewVariantName)
    }

    const removeTab = () => {
        const newVariants = variants.filter((variant) => variant.variantName !== activeKey)
        if (newVariants.length < 1) {
            router.push(`/apps`)
            return
        }
        let newActiveKey = ""
        if (newVariants.length > 0) {
            newActiveKey = newVariants[newVariants.length - 1].variantName
        }
        setVariants(newVariants)
        setActiveKey(newActiveKey)
        setUnsavedVariants((prev) => {
            const newUnsavedVariants = {...prev}
            delete newUnsavedVariants[activeKey]
            return newUnsavedVariants
        })
    }

    const fetchData = async () => {
        try {
            const backendVariants = await fetchVariants(appId)
            if (backendVariants.length > 0) {
                setVariants(backendVariants)
                if (!activeKey) setActiveKey(backendVariants[0].variantName)
            }
            setIsLoading(false)
        } catch (error) {
            setIsError(true)
            setIsLoading(false)
        }
    }

    useEffect(() => {
        fetchData()
    }, [appId])

    // Load environments
    const [environments, setEnvironments] = useState<Environment[]>([])
    const loadEnvironments = async () => {
        const response: Environment[] = await fetchEnvironments(appId)
        if (response.length === 0) return

        setEnvironments(response)
    }
    useEffect(() => {
        if (!appId) return
        loadEnvironments()
    }, [appId, activeKey])

    useBlockNavigation(
        Object.values(unsavedVariants).reduce((acc, curr) => acc || curr, false),
        {
            title: "Unsaved changes",
            message: (
                <span>
                    You have unsaved changes in your Variant(s). Do you want to save these changes
                    before leaving the page?
                </span>
            ),
            width: 500,
            okText: "Save",
            onOk: async () => {
                const promises = Object.keys(unsavedVariants).map((name) =>
                    unsavedVariants[name] ? variantHelpers.current[name].save() : Promise.resolve(),
                )
                await Promise.all(promises)
                return true
            },
            onCancel: async () => {
                setUnsavedVariants({})
                return true
            },
            cancelText: "Proceed without saving",
        },
        (newRoute) => !newRoute.includes("playground"),
    )

    if (isError) return <div>failed to load variants for app {appId}</div>
    if (isLoading) return <div>loading variants...</div>

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

    const deleteVariant = (deleteAction?: Function) => {
        AlertPopup({
            title: "Delete Variant",
            message: (
                <span>
                    You're about to delete this variant. This action is irreversible.
                    <br />
                    Are you sure you want to proceed?
                </span>
            ),
            okButtonProps: {
                type: "primary",
                danger: true,
            },
            onOk: async () => {
                try {
                    if (deleteAction) await deleteAction()
                    removeTab()
                    messageApi.open({
                        type: "success",
                        content: "Variant removed successfully!",
                    })
                } catch {}
            },
        })
    }

    // Map the variants array to create the items array conforming to the Tab interface
    const tabItems: PlaygroundTabsItem[] = variants.map((variant, index) => ({
        key: variant.variantName,
        label: `Variant ${variant.variantName}`,
        children: (
            <ViewNavigation
                variant={variant}
                handlePersistVariant={handlePersistVariant}
                environments={environments}
                onAdd={fetchData}
                deleteVariant={deleteVariant}
                onStateChange={(isDirty) =>
                    setUnsavedVariants((prev) => ({...prev, [variant.variantName]: isDirty}))
                }
                getHelpers={(helpers) => (variantHelpers.current[variant.variantName] = helpers)}
            />
        ),
        closable: !variant.persistent,
    }))

    return (
        <div>
            {contextHolder}

            <TestContextProvider>
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
                        onEdit={(_, action) => {
                            if (action === "add") {
                                setIsModalOpen(true)
                            } else if (action === "remove") {
                                deleteVariant()
                            }
                        }}
                        items={tabItems}
                    />
                </div>
            </TestContextProvider>

            <NewVariantModal
                isModalOpen={isModalOpen}
                setIsModalOpen={setIsModalOpen}
                addTab={addTab}
                variants={variants}
                setNewVariantName={setNewVariantName}
                newVariantName={newVariantName}
                setTemplateVariantName={setTemplateVariantName}
            />
        </div>
    )
}

export default Playground

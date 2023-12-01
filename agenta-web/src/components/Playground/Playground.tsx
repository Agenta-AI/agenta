import React, {useState, useEffect, useRef} from "react"
import {Button, Tabs, message} from "antd"
import ViewNavigation from "./ViewNavigation"
import NewVariantModal from "./NewVariantModal"
import {fetchEnvironments, fetchVariants} from "@/lib/services/api"
import {Variant, PlaygroundTabsItem, Environment} from "@/lib/Types"
import {AppstoreOutlined, SyncOutlined} from "@ant-design/icons"
import {useRouter} from "next/router"
import {useQueryParam} from "@/hooks/useQuery"
import AlertPopup from "../AlertPopup/AlertPopup"
import useBlockNavigation from "@/hooks/useBlockNavigation"
import type {DragEndEvent} from "@dnd-kit/core"
import {DndContext, PointerSensor, useSensor} from "@dnd-kit/core"
import {arrayMove, SortableContext, horizontalListSortingStrategy} from "@dnd-kit/sortable"
import DraggableTabNode from "../DraggableTabNode/DraggableTabNode"
import {useLocalStorage} from "usehooks-ts"

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
    const sensor = useSensor(PointerSensor, {activationConstraint: {distance: 50}}) // Initializes a PointerSensor with a specified activation distance.
    const [compareMode, setCompareMode] = useLocalStorage("compareMode", false)
    const tabID = useRef("")

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
        const toDelete = compareMode
            ? variants.find((item) => item.variantId === tabID.current)?.variantName || ""
            : activeKey
        const newVariants = variants.filter((variant) => variant.variantName !== toDelete)
        if (newVariants.length < 1) {
            router.push(`/apps`)
            return
        }
        let newActiveKey = ""
        if (newVariants.length > 0) {
            newActiveKey = newVariants[newVariants.length - 1].variantName
        }

        setVariants(newVariants)
        setUnsavedVariants((prev) => {
            const newUnsavedVariants = {...prev}
            delete newUnsavedVariants[toDelete]
            return newUnsavedVariants
        })
        setActiveKey(newActiveKey)
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

    /**
     * Handles the drag-and-drop event for tabs. It reorders the tabs in the `variants` array
     * based on the drag result. The function checks if a tab is dropped over a different tab
     * and updates the order accordingly.
     *
     * @param event The drag end event with active (dragged item) and over (drop target) properties.
     */
    const onDragEnd = (event: DragEndEvent) => {
        const {active, over} = event

        if (over && active.id !== over.id) {
            const activeId = active.id as string
            const overId = over.id as string

            setVariants((prev) => {
                const activeIndex = prev.findIndex((variant) => variant.variantName === activeId)
                const overIndex = prev.findIndex((variant) => variant.variantName === overId)

                if (activeIndex !== -1 && overIndex !== -1) {
                    return arrayMove(prev, activeIndex, overIndex)
                }
                return prev
            })
        }
    }

    // Map the variants array to create the items array conforming to the Tab interface
    const tabItems: PlaygroundTabsItem[] = variants.map((variant, index) => ({
        key: variant.variantName,
        label: `Variant ${variant.variantName}`,
        children: (
            <ViewNavigation
                compareMode={compareMode}
                variant={variant}
                handlePersistVariant={handlePersistVariant}
                environments={environments}
                onAdd={fetchData}
                deleteVariant={deleteVariant}
                onStateChange={(isDirty) =>
                    setUnsavedVariants((prev) => ({...prev, [variant.variantName]: isDirty}))
                }
                getHelpers={(helpers) => (variantHelpers.current[variant.variantName] = helpers)}
                tabID={tabID}
            />
        ),
        closable: !variant.persistent,
    }))

    return (
        <div>
            {contextHolder}

            <div>
                <div
                    style={{
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "right",
                        gap: 10,
                        margin: "10px 0",
                    }}
                >
                    {compareMode && (
                        <Button
                            onClick={() => {
                                setIsModalOpen(true)
                            }}
                        >
                            Add Variant
                        </Button>
                    )}
                    <Button
                        onClick={() => setCompareMode(!compareMode)}
                        icon={<AppstoreOutlined />}
                    >
                        {!compareMode ? "Side-by-Side View" : "Tab View"}
                    </Button>
                    <Button
                        type="primary"
                        icon={<SyncOutlined />}
                        onClick={() => {
                            setIsLoading(true)
                            fetchData()
                        }}
                    >
                        Refresh
                    </Button>
                </div>
                {compareMode ? (
                    <div style={{display: "flex", width: "100%", gap: 10, overflowX: "auto"}}>
                        {variants.map((variant, ix) => (
                            <Tabs
                                key={variant.variantName}
                                className="editable-card"
                                type="card"
                                style={{minWidth: 650, width: "100%"}}
                                items={[tabItems[ix]]}
                            />
                        ))}
                    </div>
                ) : (
                    <Tabs
                        className="editable-card"
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
                        renderTabBar={(tabBarProps, DefaultTabBar) => (
                            <DndContext sensors={[sensor]} onDragEnd={onDragEnd}>
                                <SortableContext
                                    items={tabItems.map((i) => i.key)}
                                    strategy={horizontalListSortingStrategy}
                                >
                                    <DefaultTabBar {...tabBarProps}>
                                        {(node) => (
                                            <DraggableTabNode {...node.props} key={node.key}>
                                                {node}
                                            </DraggableTabNode>
                                        )}
                                    </DefaultTabBar>
                                </SortableContext>
                            </DndContext>
                        )}
                    />
                )}
            </div>

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

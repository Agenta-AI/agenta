// VersionTabs.tsx

import React, {useState, useEffect} from "react"
import {Tabs, message} from "antd"
import ViewNavigation from "./ViewNavigation"
import VariantRemovalWarningModal from "./VariantRemovalWarningModal"
import NewVariantModal from "./NewVariantModal"
import router, {useRouter} from "next/router"
import {fetchVariants, removeVariant} from "@/lib/services/api"
import {Variant, PlaygroundTabsItem} from "@/lib/Types"

function addTab(
    setActiveKey: any,
    setVariants: any,
    variants: Variant[],
    templateVariantName: string,
    newVariantName: string,
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

    setVariants((prevState: any) => [...prevState, newVariant])
    setActiveKey(updateNewVariantName)
}

function removeTab(setActiveKey: any, setVariants: any, variants: Variant[], activeKey: string) {
    console.log(activeKey)
    const newVariants = variants.filter((variant) => variant.variantName !== activeKey)
    if (newVariants.length < 1) {
        router.push(`/apps`)
    }
    let newActiveKey = ""
    if (newVariants.length > 0) {
        newActiveKey = newVariants[newVariants.length - 1].variantName
    }
    console.log(newActiveKey, newVariants)
    setVariants(newVariants)
    setActiveKey(newActiveKey)
}

const VersionTabs: React.FC = () => {
    const router = useRouter()
    const appName = router.query.app_name as unknown as string
    const variantName = router.query.variant_name as unknown as string
    const [templateVariantName, setTemplateVariantName] = useState("") // We use this to save the template variant name when the user creates a new variant
    const [activeKey, setActiveKey] = useState("")
    const [tabList, setTabList] = useState([])
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

    useEffect(() => {
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

        fetchData()
    }, [appName])

    useEffect(() => {
        let pushUrl = ""
        if (variantName) {
            pushUrl = router.asPath?.replace(encodeURI(variantName), activeKey) as string
        } else {
            pushUrl = `${router.asPath}?variant_name=${activeKey}` as string
        }
        router.push(pushUrl)
    }, [variantName, activeKey])

    if (isError) return <div>failed to load variants</div>
    if (isLoading) return <div>loading variants...</div>

    const handleRemove = () => {
        if (removalVariantName) {
            removeTab(setActiveKey, setVariants, variants, removalVariantName)
        }
        setRemovalWarningModalOpen1(false)
    }
    const handleBackendRemove = async () => {
        if (removalVariantName) {
            setIsDeleteLoading(true)
            // only call the backend if the variant is persistent
            if (variants.find((variant) => variant.variantName === removalVariantName)?.persistent)
                await removeVariant(appName, removalVariantName)

            removeTab(setActiveKey, setVariants, variants, removalVariantName)
            setIsDeleteLoading(false)
        }
        setRemovalWarningModalOpen1(false)
        removedSuccessfully()
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
    const removedSuccessfully = () => {
        messageApi.open({
            type: "success",
            content: "Variant removed successfully!",
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
                setRemovalVariantName={setRemovalVariantName}
                setRemovalWarningModalOpen={setRemovalWarningModalOpen2}
                isDeleteLoading={isDeleteLoading && removalVariantName === variant.variantName}
            />
        ),
        closable: !variant.persistent,
    }))

    return (
        <div>
            {contextHolder}

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

            <NewVariantModal
                isModalOpen={isModalOpen}
                setIsModalOpen={setIsModalOpen}
                addTab={() =>
                    addTab(setActiveKey, setVariants, variants, templateVariantName, newVariantName)
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

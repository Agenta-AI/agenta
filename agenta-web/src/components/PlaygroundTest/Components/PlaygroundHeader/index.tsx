import {memo, useCallback, useMemo, useState, useTransition} from "react"
import {Typography, message} from "antd"
import AddButton from "./../../assets/AddButton"
import usePlaygroundVariants from "../../hooks/usePlaygroundVariants"
import NewVariantModal from "../NewVariantModal"
// import cloneDeep from "lodash/cloneDeep"
// import {v4 as uuidv4} from "uuid"
import { Variant } from "@/lib/Types"

const PlaygroundHeader = () => {
    const [displayModal, _setDisplayModal] = useState(false)
    const [newVariantName, setNewVariantName] = useState("")
    const [baseVariantName, setBaseVariantName] = useState("")
    const [messageApi, contextHolder] = message.useMessage()
    const [isPending, startTransition] = useTransition()

    const setDisplayModal = useCallback((value: boolean) => {
        startTransition(() => {
            _setDisplayModal(value)
        })
    }, [])

    console.log("render PlaygroundHeader")
    const {addVariant, variants} = usePlaygroundVariants({
        neverFetch: true,
        hookId: "root",
    })

    const baseVariant = useMemo(() => {
        return variants.find((variant) => variant.variantName === baseVariantName)
    }, [variants, baseVariantName])

    const addNewVariant = useCallback(() => {
        if (!baseVariant) {
            message.error("Template variant not found. Please choose a valid variant.")
            return
        }

        // const newTemplateVariantName = baseVariant.templateVariantName
        //     ? baseVariant.templateVariantName
        //     : newVariantName
        // const updateNewVariantName = `${baseVariant.baseName}.${newVariantName}`

        // newVariant.variantName = `${baseVariant.baseName}.${newVariantName}`
        // newVariant.variantId = uuidv4()

        // Check if variant with the same name already exists
        // const existingVariant = variants.find(
        //     (variant) => variant.variantName === updateNewVariantName,
        // )
        // Check if the variant exists
        // if (existingVariant) {
        //     message.error(
        //         "A variant with this name already exists. Please choose a different name.",
        //     )
        //     return
        // }

        // const existingParameters = baseVariant.schema?.promptConfig?.[0].llm_config.value
        // console.log("existingParameters", existingParameters)

        // const newVariantBody: Partial<Variant> = {
        //     variantName: updateNewVariantName,
        //     templateVariantName: newTemplateVariantName,
        //     previousVariantName: baseVariant.variantName,
        //     persistent: false,
        //     parameters: existingParameters,
        //     baseId: baseVariant.baseId,
        //     baseName: baseVariant.baseName || newTemplateVariantName,
        //     configName: newVariantName,
        // }

        

        addVariant({
            baseVariantName: baseVariant.variantName,
            newVariantName: newVariantName,
        })
    }, [baseVariant, variants, newVariantName, addVariant])

    return (
        <>
            {contextHolder}
            <div className="flex items-center gap-4 px-2.5 py-2">
                <Typography className="text-[16px] leading-[18px] font-[600]">
                    Playground
                </Typography>
                <AddButton
                    label={"Variant"}
                    onClick={() => {
                        setDisplayModal(true)
                    }}
                />
                <NewVariantModal
                    variants={variants}
                    isModalOpen={displayModal}
                    setIsModalOpen={setDisplayModal}
                    newVariantName={newVariantName}
                    setNewVariantName={setNewVariantName}
                    addTab={addNewVariant}
                    setTemplateVariantName={(name) => {
                        console.log("set template variant name", name)
                        setBaseVariantName(name)
                    }}
                />
            </div>
        </>
    )
}

export default memo(PlaygroundHeader)

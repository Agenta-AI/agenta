export type CreateVariantModalProps = {
    isModalOpen: boolean
    setIsModalOpen: (value: boolean) => void
    addTab: () => void
    variants: any[]
    setNewVariantName: (value: string) => void
    newVariantName: string
    setTemplateVariantName: (value: string) => void
}

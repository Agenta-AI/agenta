import {useState} from "react"

import {Dropdown, Modal, Typography} from "antd"

import DiffView from "@/oss/components/Editor/DiffView"
import VariantDetailsWithStatus from "@/oss/components/VariantDetailsWithStatus"
import {Variant} from "@/oss/lib/Types"

const {Title, Text} = Typography

type VariantComparisonModalProps = {
    compareVariantList: Variant[]
    allVariants?: Variant[] // All available variants for selection
} & React.ComponentProps<typeof Modal>

const VariantComparisonModal = ({
    compareVariantList,
    allVariants,
    ...props
}: VariantComparisonModalProps) => {
    const [originalVariantId, setOriginalVariantId] = useState(compareVariantList[0]?.id)
    const [modifiedVariantId, setModifiedVariantId] = useState(compareVariantList[1]?.id)

    // Use allVariants if provided, otherwise fall back to compareVariantList
    const availableVariants = allVariants || compareVariantList

    const originalVariant =
        availableVariants.find((v) => v.id === originalVariantId) || compareVariantList[0]
    const modifiedVariant =
        availableVariants.find((v) => v.id === modifiedVariantId) || compareVariantList[1]

    const formatTimestamp = (timestamp: number) => {
        return new Date(timestamp * 1000).toLocaleString()
    }

    const createDropdownItems = (currentVariantId: string, onSelect: (id: string) => void) => {
        return availableVariants.map((variant) => ({
            key: variant.id,
            label: (
                <div className="flex items-center justify-between w-full py-2">
                    <VariantDetailsWithStatus
                        variantName={variant.name}
                        revision={variant.revision}
                        variant={variant}
                        showBadges={false}
                        className="flex-1"
                    />
                    <Typography.Text type="secondary" className="text-xs ml-2">
                        {formatTimestamp(variant.createdAtTimestamp)}
                    </Typography.Text>
                </div>
            ),
            onClick: () => onSelect(variant.id),
            disabled: variant.id === currentVariantId,
        }))
    }

    const originalDropdownItems = createDropdownItems(originalVariantId, setOriginalVariantId)
    const modifiedDropdownItems = createDropdownItems(modifiedVariantId, setModifiedVariantId)

    return (
        <Modal
            centered
            width={"fit-content"}
            footer={null}
            {...props}
            style={{
                ...(props.style || {}),
                maxWidth: "85vw",
            }}
        >
            <div className="flex gap-6 h-[600px]">
                {/* Left sidebar with variant information */}
                <div className="w-80 flex-shrink-0 space-y-4">
                    <Title level={4} className="!mb-4">
                        Variant Comparison
                    </Title>

                    <div className="space-y-6">
                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-red-100 border border-red-300 rounded"></div>
                                <Text strong className="text-red-700">
                                    Original Version
                                </Text>
                            </div>
                            <div className="ml-5">
                                <div className="p-3 bg-red-50 rounded-lg border border-red-200">
                                    <div className="mb-3">
                                        {availableVariants.length > 2 ? (
                                            <Dropdown
                                                menu={{items: originalDropdownItems}}
                                                trigger={["click"]}
                                                placement="bottomLeft"
                                            >
                                                <div className="cursor-pointer hover:bg-red-100 rounded p-1 -m-1 transition-colors">
                                                    <VariantDetailsWithStatus
                                                        variantName={originalVariant.name}
                                                        revision={originalVariant.revision}
                                                        variant={originalVariant}
                                                        showBadges={true}
                                                    />
                                                </div>
                                            </Dropdown>
                                        ) : (
                                            <VariantDetailsWithStatus
                                                variantName={originalVariant.name}
                                                revision={originalVariant.revision}
                                                variant={originalVariant}
                                                showBadges={true}
                                            />
                                        )}
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div>
                                            <Text strong>Modified by:</Text>{" "}
                                            <Text>{originalVariant.modifiedBy}</Text>
                                        </div>
                                        <div>
                                            <Text strong>Created:</Text>{" "}
                                            <Text type="secondary">
                                                {formatTimestamp(
                                                    originalVariant.createdAtTimestamp,
                                                )}
                                            </Text>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>

                        <div className="space-y-3">
                            <div className="flex items-center gap-2">
                                <div className="w-3 h-3 bg-green-100 border border-green-300 rounded"></div>
                                <Text strong className="text-green-700">
                                    Modified Version
                                </Text>
                            </div>
                            <div className="ml-5">
                                <div className="p-3 bg-green-50 rounded-lg border border-green-200">
                                    <div className="mb-3">
                                        {availableVariants.length > 2 ? (
                                            <Dropdown
                                                menu={{items: modifiedDropdownItems}}
                                                trigger={["click"]}
                                                placement="bottomLeft"
                                            >
                                                <div className="cursor-pointer hover:bg-green-100 rounded p-1 -m-1 transition-colors">
                                                    <VariantDetailsWithStatus
                                                        variantName={modifiedVariant.name}
                                                        revision={modifiedVariant.revision}
                                                        variant={modifiedVariant}
                                                        showBadges={true}
                                                    />
                                                </div>
                                            </Dropdown>
                                        ) : (
                                            <VariantDetailsWithStatus
                                                variantName={modifiedVariant.name}
                                                revision={modifiedVariant.revision}
                                                variant={modifiedVariant}
                                                showBadges={true}
                                            />
                                        )}
                                    </div>
                                    <div className="space-y-2 text-sm">
                                        <div>
                                            <Text strong>Modified by:</Text>{" "}
                                            <Text>{modifiedVariant.modifiedBy}</Text>
                                        </div>
                                        <div>
                                            <Text strong>Created:</Text>{" "}
                                            <Text type="secondary">
                                                {formatTimestamp(
                                                    modifiedVariant.createdAtTimestamp,
                                                )}
                                            </Text>
                                        </div>
                                    </div>
                                </div>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Right side with diff view */}
                <div className="flex-1 min-w-0 p-4">
                    <DiffView
                        language="json"
                        original={JSON.stringify(originalVariant.parameters, null, 2)}
                        modified={JSON.stringify(modifiedVariant.parameters, null, 2)}
                        className="border rounded-lg h-full overflow-auto"
                    />
                </div>
            </div>
        </Modal>
    )
}

export default VariantComparisonModal

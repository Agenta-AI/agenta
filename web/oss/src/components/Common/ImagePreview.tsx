import {useState} from "react"

import {MagnifyingGlassPlus} from "@phosphor-icons/react"
import {Modal} from "antd"

import ImageWithFallback from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/PromptImageUpload/assets/components/ImageWithFallback"

interface ImagePreviewProps {
    /** thumbnail & full preview source */
    src: string
    /** alt text */
    alt?: string
    /** square thumbnail size in px (default 48) */
    size?: number
    /** optional className for thumbnail */
    className?: string
    /** optional boolean to disable the preview */
    isValidPreview: boolean
}

/**
 * Small clickable image thumbnail that opens an Ant Design Modal with a larger preview.
 * Extracted from PromptImageUpload for reuse in evaluation run views.
 */
const ImagePreview = ({
    src,
    alt = "Preview",
    size = 48,
    className = "",
    isValidPreview,
}: ImagePreviewProps) => {
    const [open, setOpen] = useState(false)

    const isSafeImageSrc = (url: string) => /^https?:\/\/[^ "]+$/i.test(url)

    return (
        <>
            <div
                className={`relative group rounded overflow-hidden cursor-pointer flex-shrink-0 ${className}`}
                style={{width: size, height: size}}
                onClick={(e) => {
                    e.stopPropagation()
                    setOpen(true)
                }}
            >
                <ImageWithFallback
                    src={src}
                    alt={alt}
                    className="w-full h-full object-cover group-hover:opacity-80 transition duration-200"
                />
                <div className="absolute inset-0 bg-black bg-opacity-10 group-hover:bg-opacity-20 transition duration-200" />
                <div className="absolute inset-0 flex items-center justify-center text-white opacity-0 group-hover:opacity-100 transition duration-200">
                    <MagnifyingGlassPlus size={16} weight="bold" />
                </div>
            </div>
            <Modal
                open={open}
                footer={null}
                onCancel={() => setOpen(false)}
                width="auto"
                bodyStyle={{padding: 0, display: "flex", justifyContent: "center"}}
            >
                {isValidPreview && isSafeImageSrc(src) && (
                    <img src={src} alt={alt} style={{maxWidth: "80vw", maxHeight: "80vh"}} />
                )}
            </Modal>
        </>
    )
}

export default ImagePreview

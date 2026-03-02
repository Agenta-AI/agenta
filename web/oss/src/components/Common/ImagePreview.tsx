import {useMemo, useState} from "react"

import {MagnifyingGlassPlus} from "@phosphor-icons/react"
import {Modal} from "antd"

import ImageWithFallback from "@/oss/components/Playground/Components/PlaygroundVariantPropertyControl/assets/PromptImageUpload/assets/components/ImageWithFallback"
import {dataUriToObjectUrl, isBase64} from "@/oss/lib/helpers/utils"

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
    isValidPreview = true,
}: ImagePreviewProps) => {
    const [open, setOpen] = useState(false)

    const isSafeImageSrc = (url: string) => {
        if (!url) return false
        // Only allow valid https/http image URLs, blob URLs, or safe data:image URLs
        try {
            // Block javascript: and other schemes
            const lower = url.toLowerCase().trim()
            // Only allow https/http with proper image extensions
            if (/^https?:\/\/[^ "]+$/i.test(lower)) {
                // Optional: Allow only image file extensions
                if (/\.(png|jpe?g|gif|webp)(\?.*)?$/i.test(lower)) {
                    // Further checking could be done here (e.g., image mimetype fetch), but for now file extension is checked
                    return true
                }
                // Otherwise, reject
                return false
            }
            // Allow blob: URLs (browser-generated, controlled)
            if (lower.startsWith("blob:")) return true
            // Only allow specific data:image/*;base64 URLs
            if (/^data:image\/(png|jpe?g|gif|webp);base64,[a-z0-9+/=]+$/i.test(lower)) return true
            // Otherwise, reject
            return false
        } catch {
            return false
        }
    }

    const imageURL = useMemo(() => {
        try {
            return isBase64(src) ? dataUriToObjectUrl(src) : src
        } catch (error) {
            return src
        }
    }, [src])

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
                centered
                width={800}
                height={600}
            >
                {isValidPreview && isSafeImageSrc(imageURL) && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                        src={imageURL}
                        alt={alt}
                        className="w-full h-full max-h-[600px] max-w-[800px] object-contain"
                    />
                )}
            </Modal>
        </>
    )
}

export default ImagePreview

/**
 * ImageWithFallback Component
 *
 * An image element that displays a fallback icon when the image fails to load.
 *
 * @example
 * ```tsx
 * import { ImageWithFallback } from '@agenta/ui'
 *
 * <ImageWithFallback
 *   src="https://example.com/image.jpg"
 *   alt="Preview"
 *   className="w-full h-full object-cover"
 * />
 * ```
 */

import {useEffect, useState} from "react"

import {ImageBroken} from "@phosphor-icons/react"

import {isSafeImageSrc} from "./utils"

// ============================================================================
// TYPES
// ============================================================================

export interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    /**
     * Custom fallback content when image fails to load
     */
    fallback?: React.ReactNode
}

// ============================================================================
// COMPONENT
// ============================================================================

/**
 * Renders an image with automatic error handling and fallback display
 */
const ImageWithFallback = ({src, alt, fallback, ...props}: ImageWithFallbackProps) => {
    const [hasError, setHasError] = useState(false)

    useEffect(() => {
        setHasError(false)
    }, [src])

    const safeSrc = typeof src === "string" && isSafeImageSrc(src) ? src : undefined

    if (!safeSrc || hasError) {
        return fallback ?? <ImageBroken size={48} className="text-[#D61010]" />
    }

    return <img src={safeSrc} alt={alt} onError={() => setHasError(true)} {...props} />
}

export default ImageWithFallback

import {useEffect, useState} from "react"

import {ImageBroken} from "@phosphor-icons/react"

interface ImageWithFallbackProps extends React.ImgHTMLAttributes<HTMLImageElement> {
    fallback?: React.ReactNode
}

const ImageWithFallback = ({src, alt, fallback, ...props}: ImageWithFallbackProps) => {
    const [hasError, setHasError] = useState(false)

    useEffect(() => {
        setHasError(false)
    }, [src])

    if (!src || hasError) {
        return fallback ?? <ImageBroken size={48} className="text-[#D61010]" />
    }

    // eslint-disable-next-line @next/next/no-img-element
    return <img src={src} alt={alt} onError={() => setHasError(true)} {...props} />
}

export default ImageWithFallback

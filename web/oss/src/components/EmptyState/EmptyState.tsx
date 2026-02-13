import type {ReactNode} from "react"
import {useState} from "react"

import {Stream} from "@cloudflare/stream-react"
import {ArrowRight} from "@phosphor-icons/react"
import {Button, Skeleton, Typography} from "antd"
import clsx from "clsx"

export interface EmptyStateProps {
    /** Cloudflare Stream video ID (preferred) */
    videoId?: string
    /** Fallback: URL to video (mp4) or image (gif/png/jpg) */
    previewUrl?: string
    /** Alt text for image, or aria-label for video */
    previewAlt: string
    title: string
    description: string
    primaryCta: {
        label?: string
        onClick?: () => void
        icon?: ReactNode
        node?: ReactNode
    }
    secondaryCta?: {
        label: string
        href: string
    }
    className?: string
}

const VIDEO_ASPECT_RATIO = 16 / 9

const EmptyState = ({
    videoId,
    previewUrl,
    previewAlt,
    title,
    description,
    primaryCta,
    secondaryCta,
    className,
}: EmptyStateProps) => {
    const [videoLoaded, setVideoLoaded] = useState(false)
    const [imageLoaded, setImageLoaded] = useState(false)
    const [loadError, setLoadError] = useState(false)

    const hasPreview = !!(videoId || previewUrl)
    const isLoading = hasPreview && !videoLoaded && !imageLoaded && !loadError

    const renderPreview = () => {
        // Cloudflare Stream video
        if (videoId) {
            return (
                <Stream
                    src={videoId}
                    controls
                    autoplay
                    muted
                    loop
                    responsive
                    preload="auto"
                    onCanPlay={() => setVideoLoaded(true)}
                    onPlaying={() => setVideoLoaded(true)}
                    onError={() => setLoadError(true)}
                />
            )
        }

        // Fallback: local video file
        if (previewUrl?.endsWith(".mp4") || previewUrl?.endsWith(".webm")) {
            return (
                <video
                    src={previewUrl}
                    aria-label={previewAlt}
                    controls
                    autoPlay
                    loop
                    muted
                    playsInline
                    controlsList="nodownload"
                    className="w-full"
                    width={768}
                    height={432}
                    onLoadedData={() => setVideoLoaded(true)}
                    onError={() => setLoadError(true)}
                />
            )
        }

        // Fallback: image
        if (previewUrl) {
            return (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                    src={previewUrl}
                    alt={previewAlt}
                    className="block w-full"
                    width={768}
                    height={432}
                    onLoad={() => setImageLoaded(true)}
                    onError={() => setLoadError(true)}
                />
            )
        }

        return null
    }

    return (
        <div className={clsx("mx-auto w-full max-w-4xl px-8 py-8", className)}>
            <div className="flex w-full flex-col items-center text-center">
                {/* Title + Description */}
                <div className="mb-6">
                    <Typography.Title
                        level={3}
                        className="!mb-2 !text-2xl !font-bold !text-[#101828]"
                        style={{textWrap: "balance"}}
                    >
                        {title}
                    </Typography.Title>

                    <Typography.Paragraph
                        type="secondary"
                        className="mx-auto max-w-2xl !text-base !text-[#475467]"
                        style={{marginBottom: 0, textWrap: "pretty"}}
                    >
                        {description}
                    </Typography.Paragraph>
                </div>

                {/* CTAs */}
                <div className="mb-8 flex flex-wrap items-center justify-center gap-4">
                    {primaryCta.node ?? (
                        <Button
                            type="primary"
                            size="large"
                            onClick={primaryCta.onClick}
                            icon={primaryCta.icon}
                            className="!px-8"
                        >
                            {primaryCta.label}
                        </Button>
                    )}

                    {secondaryCta ? (
                        <Button
                            type="default"
                            size="large"
                            href={secondaryCta.href}
                            target="_blank"
                            rel="noreferrer"
                            icon={<ArrowRight size={16} />}
                            iconPosition="end"
                            className="!px-8"
                        >
                            {secondaryCta.label}
                        </Button>
                    ) : null}
                </div>

                {/* Video / Image Preview with fixed aspect ratio container */}
                {hasPreview && !loadError && (
                    <div
                        className="relative w-full max-w-3xl overflow-hidden rounded-lg border border-gray-200 bg-gray-50"
                        style={{aspectRatio: VIDEO_ASPECT_RATIO}}
                    >
                        {/* Skeleton shown while loading */}
                        {isLoading && (
                            <div className="absolute inset-0 flex items-center justify-center">
                                <Skeleton.Node active style={{width: "100%", height: "100%"}}>
                                    <div />
                                </Skeleton.Node>
                            </div>
                        )}

                        {/* Actual content */}
                        <div
                            className="absolute inset-0 transition-opacity duration-300"
                            style={{opacity: isLoading ? 0 : 1}}
                        >
                            {renderPreview()}
                        </div>
                    </div>
                )}
            </div>
        </div>
    )
}

export default EmptyState

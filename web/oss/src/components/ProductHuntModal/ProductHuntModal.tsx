import React, {useEffect, useState} from "react"

import {Modal} from "antd"
import dayjs from "dayjs"
import {useLocalStorage} from "usehooks-ts"

const ProductHuntModal = () => {
    const [isModalOpen, setIsModalOpen] = useState(false)
    const [hasSeenModal, setHasSeenModal] = useLocalStorage("agenta_ph_modal_shown_2025", false)

    useEffect(() => {
        // Time window: Nov 28th 9am CET to Nov 29th 9am CET
        // CET is UTC+1 (Standard Time)
        const startTime = dayjs("2025-11-28T09:00:00+01:00")
        const endTime = dayjs("2025-11-29T09:00:00+01:00")
        const now = dayjs()

        if (now.isAfter(startTime) && now.isBefore(endTime) && !hasSeenModal) {
            setIsModalOpen(true)
        }
    }, [hasSeenModal])

    const handleClose = () => {
        setHasSeenModal(true)
        setIsModalOpen(false)
    }

    return (
        <Modal
            open={isModalOpen}
            onCancel={handleClose}
            footer={null}
            closable={false}
            centered
            width={400}
            className="p-0"
            styles={{
                content: {
                    padding: 0,
                    borderRadius: "16px",
                    overflow: "hidden",
                },
            }}
        >
            <div className="relative flex flex-col items-center pt-8 pb-6 px-6 bg-white dark:bg-[#141414]">
                <button
                    onClick={handleClose}
                    className="absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors bg-transparent border-none cursor-pointer flex items-center justify-center p-1"
                >
                    <svg
                        xmlns="http://www.w3.org/2000/svg"
                        width="20"
                        height="20"
                        viewBox="0 0 24 24"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    >
                        <line x1="18" y1="6" x2="6" y2="18"></line>
                        <line x1="6" y1="6" x2="18" y2="18"></line>
                    </svg>
                </button>

                <div className="mb-4 text-4xl animate-bounce">🚀</div>

                <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2 text-center">
                    We're live on Product Hunt!
                </h2>

                <p className="text-gray-600 dark:text-gray-300 text-center mb-6 text-[15px] leading-relaxed">
                    We'd love your support! Check out our launch and let us know what you think.
                </p>

                <a
                    href="https://www.producthunt.com/products/agenta?embed=true&utm_source=badge-featured&utm_medium=badge&utm_source=badge-agenta"
                    target="_blank"
                    rel="noreferrer"
                    onClick={handleClose}
                    className="transition-transform hover:scale-105 duration-200"
                >
                    <img
                        src="https://api.producthunt.com/widgets/embed-image/v1/featured.svg?post_id=1031958&theme=neutral&t=1764272929088"
                        alt="Agenta - Open-source prompt management & evals for AI teams | Product Hunt"
                        style={{width: "250px", height: "54px"}}
                        width="250"
                        height="54"
                    />
                </a>

                <button
                    onClick={handleClose}
                    className="mt-6 text-sm text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors bg-transparent border-none cursor-pointer"
                >
                    Maybe later
                </button>
            </div>
        </Modal>
    )
}

export default ProductHuntModal

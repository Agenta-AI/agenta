// Smoothly scrolls to the generation containers bottom.
export const autoScrollToBottom = (selector = ".playground-generation") => {
    const container = document.querySelector(selector) as HTMLDivElement

    if (!container) return

    const timer = setTimeout(() => {
        container.scrollTo({
            top: container.scrollHeight,
            behavior: "smooth",
        })
    }, 200)

    return () => clearTimeout(timer)
}

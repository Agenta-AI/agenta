export const stringStorage = {
    getItem: (key: string, initialValue: string | null) => {
        if (typeof window === "undefined") return initialValue
        const storedValue = localStorage.getItem(key)
        return storedValue ?? initialValue
    },
    setItem: (key: string, newValue: string | null) => {
        if (typeof window === "undefined") return
        if (newValue === null) {
            localStorage.removeItem(key)
        } else {
            localStorage.setItem(key, newValue)
        }
    },
    removeItem: (key: string) => {
        if (typeof window === "undefined") return
        localStorage.removeItem(key)
    },
}

import dynamic from "next/dynamic"

export function dynamicComponent<T>(path: string, fallback: any = () => null) {
    return dynamic<T>(() => import(`@/ee/components/${path}`), {
        loading: fallback,
        ssr: false,
    })
}

export async function dynamicContext(path: string, fallback?: any) {
    try {
        return await import(`@/ee/contexts/${path}`)
    } catch (error) {
        return fallback
    }
}

export async function dynamicService(path: string, fallback?: any) {
    try {
        return await import(`@/ee/services/${path}`)
    } catch (error) {
        return fallback
    }
}

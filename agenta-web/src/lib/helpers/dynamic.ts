import dynamic from "next/dynamic"

export function dynamicComponent<T>(path: string, fallback: any = () => null) {
    return dynamic<T>(() => import(`@/components/${path}`), {
        loading: fallback,
        ssr: false,
    })
}

export async function dynamicContext(path: string, fallback?: any) {
    try {
        return await import(`@/contexts/${path}`)
    } catch (error) {
        return fallback
    }
}

export async function dynamicHook(path: string, fallback: any = () => null) {
    try {
        return await import(`@/hooks/${path}`)
    } catch (error) {
        return fallback
    }
}

export async function dynamicService(path: string, fallback?: any) {
    try {
        return await import(`@/services/${path}`)
    } catch (error) {
        return fallback
    }
}

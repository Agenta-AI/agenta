import dynamic from "next/dynamic"

export function dynamicComponent<T>(path: string, fallback: any = () => null) {
    return dynamic<T>(() => import(`@/components/${path}`), {
        loading: fallback,
        ssr: false,
    })
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

export async function dynamicLib(path: string, fallback?: any) {
    try {
        return await import(`@/lib/${path}`)
    } catch (error) {
        return fallback
    }
}

export async function dynamicConfig(path: string, fallback?: any) {
    try {
        return await import(`@/config/${path}`)
    } catch (error) {
        return fallback
    }
}

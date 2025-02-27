interface OptionRoot {
    label: string
}

interface CommonOption extends OptionRoot {
    value: string
}

/** Common option types */
export interface BaseOption extends CommonOption {
    group?: string
}

export interface OptionGroup extends OptionRoot {
    options: BaseOption[]
}

/** Compound types */
export interface CompoundOption extends CommonOption {
    config: {
        type: string
        schema?: Record<string, unknown>
        [key: string]: unknown
    }
}

export type SelectOptions = BaseOption[] | OptionGroup[]

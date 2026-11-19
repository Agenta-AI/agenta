export type SnakeToCamelCase<S extends string> = S extends `${infer T}_${infer U}`
    ? `${T}${Capitalize<SnakeToCamelCase<U>>}`
    : S

export type SnakeToCamelCaseKeys<T> = T extends readonly unknown[]
    ? T extends [infer First, ...infer Rest]
        ? [SnakeToCamelCaseKeys<First>, ...SnakeToCamelCaseKeys<Rest>]
        : T extends (infer U)[]
          ? SnakeToCamelCaseKeys<U>[]
          : T
    : T extends object
      ? {[K in keyof T as SnakeToCamelCase<K & string>]: SnakeToCamelCaseKeys<T[K]>}
      : T

export interface testset {
    _id?: string
    id?: string
    name: string
    created_at: string
    updated_at: string
    created_by_id?: string
    columns?: string[]
}

export type EvaluationRun = Record<string, unknown>

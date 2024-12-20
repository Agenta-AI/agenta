// Helper type for array indices
type ArrayIndex = number | `${number}`

// Core path implementation
type PathImpl<T, K extends keyof T> = K extends string
    ? T[K] extends Record<string, any>
        ? T[K] extends ArrayLike<any>
            ? K | `${K}.[${number}]` | `${K}.[${number}].${keyof T[K][number] & string}`
            : K | `${K}.${keyof T[K] & string}`
        : never
    : never

// Main Path type that includes both direct keys and nested paths
export type Path<T> = T extends object ? PathImpl<T, keyof T & string> | keyof T : never

// Get the type for a specific path, including array access
export type PathValue<T, P extends string> = P extends keyof T
    ? T[P]
    : P extends `${infer K}.${infer R}`
      ? K extends keyof T
          ? R extends `[${infer N}]${infer Rest}`
              ? N extends ArrayIndex
                  ? T[K] extends ArrayLike<infer V>
                      ? Rest extends `.${infer Rest2}`
                          ? PathValue<V, Rest2>
                          : V
                      : never
                  : never
              : PathValue<T[K], R>
          : never
      : never

// Type-safe path joining
export type JoinPath<T extends string, K extends string> = K extends "" ? T : `${T}.${K}`

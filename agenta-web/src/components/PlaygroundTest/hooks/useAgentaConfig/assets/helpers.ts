import {ConfigProperty} from "../../../state/types"
import {ModelDefaults, PromptDefaults} from "..//types"

type GroupConfigReturn<R extends boolean, P extends boolean> = R extends true
    ? P extends true
        ? PromptDefaults
        : ModelDefaults
    : ConfigProperty[]

export const groupConfigOptions = <R extends boolean = false, P extends boolean = false>({
    schemaName,
    configObject,
    filterByName = (_: string) => true,
    reduce = false as R,
}: {
    schemaName: string
    configObject: Record<string, any>
    filterByName: (propertyName: string) => boolean
    reduce?: R
}): GroupConfigReturn<R, P> => {
    const filtered = Object.keys(configObject).filter(filterByName)
    const isPromptProperty = filtered.some((name) => name.includes("prompt_"))

    return (
        reduce
            ? filtered.reduce(
                  (acc, propertyName) => ({
                      ...acc,
                      [propertyName]: configObject[propertyName],
                      key: propertyName,
                  }),
                  {} as P extends true ? PromptDefaults : ModelDefaults,
              )
            : filtered.map((propertyName) => ({
                  ...(configObject[propertyName] || {}),
                  key: propertyName,
                  configKey: `schema.components.schemas.${schemaName}.properties.agenta_config.properties.${propertyName}`,
              }))
    ) as GroupConfigReturn<R, P>
}

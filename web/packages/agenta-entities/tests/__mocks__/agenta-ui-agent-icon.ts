/** `@agenta/ui/agent-icon` for node-env tests: the real colour maths, a two-entry catalog. */
export {isHexColor} from "../../../agenta-ui/src/agent-icon/colors"

export const TEST_CATALOG = [
    {name: "robot", tags: [], categories: [], path: "<path d='M1 1'/>"},
    {name: "brain", tags: [], categories: [], path: "<path d='M2 2'/>"},
]

export const loadAgentIconCatalog = async () => TEST_CATALOG

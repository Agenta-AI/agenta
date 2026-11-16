import en from "../../locales/en/context.resolver.json"
import {defineCatalog} from "../catalog"

export default defineCatalog(
    "context.resolver",
    en,
    (language) => import(`../../locales/${language}/context.resolver.json`),
)

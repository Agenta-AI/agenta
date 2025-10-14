import {atom} from "jotai"

// search query atom
export const searchQueryAtom = atom<string>("")

// pagination atom
export const paginationAtom = atom({size: 20, page: 1})

import {atom} from "jotai"

export type OnlineEvaluationDrawerState = { open: boolean }

const defaultState: OnlineEvaluationDrawerState = { open: false }

export const onlineEvaluationDrawerAtom = atom(defaultState)

export const openOnlineEvaluationDrawerAtom = atom(null, (get, set) => {
  const cur = get(onlineEvaluationDrawerAtom)
  if (cur.open) return
  set(onlineEvaluationDrawerAtom, {...cur, open: true})
})

export const closeOnlineEvaluationDrawerAtom = atom(null, (get, set) => {
  const cur = get(onlineEvaluationDrawerAtom)
  if (!cur.open) return
  set(onlineEvaluationDrawerAtom, {...cur, open: false})
})

import {atom} from "jotai"

/**
 * A page's request for the layout's bounded full-height frame.
 *
 * Every other full-height route is recognised by its path. An agent's overview cannot be: it
 * shares `/apps/<id>/overview` with the prompt and evaluator overviews, which genuinely flow,
 * and which branch renders is decided by the agents list rather than the URL. So the page asks
 * instead of the layout guessing — the layout must not read that list itself, or every route
 * (auth pages included) subscribes to a domain query it has no other use for.
 */
export const layoutFullHeightRequestAtom = atom(false)

/**
 * An invisible hit area of at least 44 x 44 px, centered on a small control, below 768 px only.
 * The control keeps its drawn size, and the desktop does not change. Put it on the control
 * itself; an ancestor that clips its overflow also clips the area.
 */
export const PHONE_HIT_AREA_CLASS =
    "max-md:relative max-md:after:absolute max-md:after:left-1/2 max-md:after:top-1/2 max-md:after:h-full max-md:after:min-h-11 max-md:after:w-full max-md:after:min-w-11 max-md:after:-translate-x-1/2 max-md:after:-translate-y-1/2 max-md:after:content-['']"

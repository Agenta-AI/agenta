/** Opts a secret field out of password managers, which read a name plus a secret as a login. */
export const PASSWORD_MANAGER_OPT_OUT = {
    "data-1p-ignore": true,
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
} as const

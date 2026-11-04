/**
 * A name field beside a secret field and a primary button reads as a login form, so Bitwarden and
 * friends offer to save or update a login over it. Every secret field opts out explicitly.
 */
export const PASSWORD_MANAGER_OPT_OUT = {
    "data-1p-ignore": true,
    "data-lpignore": "true",
    "data-bwignore": "true",
    "data-form-type": "other",
} as const

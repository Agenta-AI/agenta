<!-- review-loop: design=4c7241bf3298 lenses=simplify,naming -->

**Review loop result** for the design at repo commit `3546fbf812`, 2 rounds.

| Lens | Final rating |
| --- | --- |
| Simplify | Low |
| Naming | Low |

**Fixed:**
- The floor role (the role a new invite or a demotion gets) has one name and a value per plan: `member` on OSS, Hobby and Pro, and `viewer` on plans with `Flag.RBAC`.
- `member` is in all three role scopes, cannot be removed by a role override, and has a description that names what it cannot read.
- The roles are documented as a set, not as a ladder.
- The downgrade of migration `a1b2c3d4e5f7` no longer turns viewers into members.
- The specs say "a person" for any member of an organization, and Member only for the role.
- One helper is the only reader of `Flag.RBAC` for offered roles, and the docstrings that said "enforcement" are updated.
- The role routes say "offered roles", and the /m role list is cached per organization.
- Extra doc lines and the admin description are in the tasks.

**Left on purpose:** the `DELETE` role route keeps its shipped name `unassign_role_from_user`, although it demotes to the floor role.

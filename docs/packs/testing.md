# Testing

Use this to test an Agenta instance.
Unless intentional, use `--env-file <path>`.
Run tests from specific to general, only as needed.
Folders, markers, and variables depend on the package under test.
If conflicts, trust scripts.

## Recipes
- Web: `cd web/tests && pnpm test:e2e -- [<folders>] [<markers>]`
- API/SDK/Services: `cd {api,sdk,services} && python run-tests.py [<markers>] -- [<folders>]`

## Folders

- Web: `../{oss,ee}/tests/playwright/{e2e,unit,utils}`
- API/SDK/Services: `{oss,ee}/tests/pytest/{e2e,unit,utils}`

## Markers

```bash
--coverage <smoke|full>
--lens <functional|performance|security>
--path <happy|grumpy>
--case <typical|edge>
--speed <fast|slow>
--cost <free|paid>
--plan <hobby|pro|business|enterprise>
--role <owner|admin|editor|viewer>
--scope <scope>
```

## Variables

```bash
AGENTA_LICENSE=
AGENTA_AUTH_KEY=
AGENTA_WEB_URL=
AGENTA_API_URL=
AGENTA_SERVICES_URL=
TESTMAIL_NAMESPACE=
TESTMAIL_API_KEY=
AGENTA_ADMIN_EMAIL=
AGENTA_ADMIN_PASSWORD=
```

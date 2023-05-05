This is a [Next.js](https://nextjs.org/) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `pages/index.tsx`. The page auto-updates as you edit the file.


## Development environment

If you need to work on the code, you need to run `npm i` in the dashboard folder as the node_modules in the host machine and the node_modules in the container **are not synced**.

**In case of a new installed package we need to rebuild the image**.

This is due to the issue below, faced when mounting node_modules.

```
agenta-dashboard-1  | yarn run v1.22.19
agenta-dashboard-1  | $ next dev
agenta-dashboard-1  | /bin/sh: next: not found
agenta-dashboard-1  | error Command failed with exit code 127.
agenta-dashboard-1  | info Visit https://yarnpkg.com/en/docs/cli/run for documentation about this command.
```
# @agenta/primitive-ui

Low-level shadcn primitives shared by Agenta frontend applications.

Generate components from the `web` directory:

```bash
pnpm dlx shadcn@4.11.0 add <component> --cwd packages/agenta-primitive-ui
```

Consume generated components through package subpaths:

```typescript
import {Button} from "@agenta/primitive-ui/components/button"
```

The package uses Tailwind CSS 4. Consumers must use a compatible Tailwind/PostCSS pipeline
before importing `@agenta/primitive-ui/styles.css`.

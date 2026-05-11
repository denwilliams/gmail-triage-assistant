# UI screenshot tool

Headless Playwright runner that loads the frontend with mocked auth + mocked
API responses, then writes one PNG per scene. Useful for attaching before/after
images to PRs without standing up the Worker backend or signing in.

## Run

```bash
# In one terminal:
npm run dev

# In another:
npm run screenshots                 # capture every scene
npm run screenshots emails-path     # filter by name substring
```

Output lands in `frontend/scripts/screenshots/output/` (gitignored). Drag the
PNGs into a PR description, or copy the ones you want to keep into
`docs/screenshots/<branch>/` and reference them via `raw.githubusercontent.com`.

Environment variables:

| Var            | Default                  | Purpose                          |
| -------------- | ------------------------ | -------------------------------- |
| `BASE_URL`     | `http://localhost:5173`  | Vite dev server URL              |
| `OUT`          | `./output`               | Output directory                 |
| `COLOR_SCHEME` | `dark`                   | `dark` or `light`                |

## Add a scene

Create or edit a file under `scenes/`:

```js
// scenes/dashboard.mjs
export default [
  {
    name: "dashboard-default",       // → output/dashboard-default.png
    path: "/dashboard",
    // Optional setup before screenshot:
    prepare: async (page) => {
      await page.getByRole("button", { name: "Refresh" }).click();
    },
    // Optional clip to a region (default = full viewport):
    clip: (page) => page.locator("[data-testid='dashboard-cards']"),
    // Optional overrides:
    viewport: { width: 1400, height: 900 },
    colorScheme: "light",
  },
];
```

`name` is also the output filename. Use `kebab-case` for consistency.

## Add fixture data

Default fixtures live in `fixtures.mjs` (`me`, `emails`). To override them for
just one scene file, export a `fixtures` object alongside the default array:

```js
// scenes/empty-state.mjs
export const fixtures = { me: { email: "x", user_id: 1 }, emails: [] };
export default [{ name: "emails-empty", path: "/emails" }];
```

## Add a mocked endpoint

`mock-api.mjs` covers `/auth/me` and `/emails`. For new endpoints, call
`registerHandler` at module load time from a scene file:

```js
// scenes/senders.mjs
import { registerHandler } from "../mock-api.mjs";

registerHandler("/senders", (_url, fx) => fx.senders ?? []);

export const fixtures = {
  me: { email: "demo@example.com", user_id: 1 },
  senders: [/* ... */],
};

export default [{ name: "senders-list", path: "/senders" }];
```

Unknown endpoints return an empty array, which is enough for many pages to
render without errors.

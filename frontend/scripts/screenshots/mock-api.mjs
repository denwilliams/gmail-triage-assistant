// Attach API route mocks to a Playwright page. The handler intercepts every
// `/api/v1/*` request and serves data from the supplied fixtures, falling back
// to an empty array / 404 for unknown endpoints.

const handlers = {
  "/auth/me": (_url, fx) => fx.me,

  "/emails": (url, fx) => {
    const bucket = url.searchParams.get("bucket");
    const stage = url.searchParams.get("pipeline_stage");
    const via = url.searchParams.get("triage_via");
    let rows = fx.emails ?? [];
    if (bucket) rows = rows.filter((e) => e.bucket === bucket);
    if (stage) rows = rows.filter((e) => e.pipeline_stage === stage);
    if (via) rows = rows.filter((e) => e.triage_via === via);
    return rows;
  },
};

export async function attachMockApi(page, fixtures) {
  await page.route("**/api/v1/**", async (route) => {
    const url = new URL(route.request().url());
    const path = url.pathname.replace("/api/v1", "");
    const handler = handlers[path];
    if (handler) {
      const body = handler(url, fixtures);
      if (body === undefined) return route.fulfill({ status: 404, json: { error: "not found" } });
      return route.fulfill({ json: body });
    }
    return route.fulfill({ json: [] });
  });
}

// Register a new mock handler. Call this from a scene file if you need to
// stub an endpoint that isn't covered by the defaults above.
export function registerHandler(path, fn) {
  handlers[path] = fn;
}

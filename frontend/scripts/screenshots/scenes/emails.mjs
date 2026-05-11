// Scenes for the /emails page. Each scene becomes one PNG under
// `output/<name>.png`. Add new scenes by appending to the exported array.

const filtersRegion = (page) => page.locator("div.space-y-2").first();
const allButton = (page, index) =>
  page.getByRole("button", { name: "All", exact: true }).nth(index);
const pill = (page, name) => page.getByRole("button", { name, exact: true });

export default [
  {
    name: "emails-filters-default",
    path: "/emails",
    clip: filtersRegion,
  },
  {
    name: "emails-path-ai-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "AI").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-path-thread-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "Thread").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-path-known-sender-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "Known sender").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-stage-bucketed-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "bucketed").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-stage-processed-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "processed").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-stage-failed-active",
    path: "/emails",
    prepare: async (page) => {
      await pill(page, "failed").click();
    },
    clip: filtersRegion,
  },
  {
    name: "emails-rows",
    path: "/emails",
    clip: (page) => page.locator("div.space-y-3").first(),
  },
];

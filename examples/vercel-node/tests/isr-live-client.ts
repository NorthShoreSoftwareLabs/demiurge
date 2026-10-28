import { hydrateFileRouter, page } from "@demiurgejs/core";
import { LiveLayout, LiveView } from "./isr-live-view";

void hydrateFileRouter({
  navigation: "server",
  routes: {
    "./routes/@layout.tsx": async () => ({ default: LiveLayout }),
    "./routes/public/[id].tsx": async () => ({ GET: page({ view: LiveView }) }),
  },
});

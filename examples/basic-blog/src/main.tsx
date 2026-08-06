import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createFileRouter } from "@demiurge/router";
import type { RouteModule } from "@demiurge/router";
import "./styles.css";

const routes = import.meta.glob<RouteModule>("./routes/**/*.tsx");
const Router = createFileRouter({ routes });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);

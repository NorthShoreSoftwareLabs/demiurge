import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { createFileRouter } from "./mini-framework/router";
import type { RouteModule } from "./mini-framework/router";
import "./styles.css";

const routes = import.meta.glob<RouteModule>("./routes/**/*.tsx");
const Router = createFileRouter({ routes });

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <Router />
  </StrictMode>,
);

export type { RouteModule } from "./mini-framework/router";

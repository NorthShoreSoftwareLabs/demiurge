import { createElement, useEffect, useState } from "react";
import { Link, type LayoutProps, type RouteProps } from "@demiurgejs/core";

declare module "@demiurgejs/core" {
  interface RouteConcretePaths {
    "private-isr-proof": "/public/one" | "/public/two";
  }
}

export type LiveData = {
  version: number;
  id: string;
  edition: string;
  generation: string;
  middlewareCalls: number;
};

export function LiveLayout({ children }: LayoutProps) {
  return createElement("section", { "data-proof-layout": "" }, children);
}

export function LiveView({ data }: RouteProps<string, LiveData>) {
  const [count, setCount] = useState(0);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);
  return createElement("main", {
    "data-version": data.version,
    "data-id": data.id,
    "data-edition": data.edition,
    "data-generation": data.generation,
    "data-middleware": data.middlewareCalls,
    "data-hydrated": String(hydrated),
  }, `Version ${data.version}`,
  createElement("button", { onClick: () => setCount(count + 1), type: "button" }, `Count ${count}`),
  createElement(Link, { to: data.id === "one" ? "/public/two" : "/public/one" }, "Other route"));
}

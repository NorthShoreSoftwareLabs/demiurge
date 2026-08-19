import { useEffect, useState } from "react";
import { defineScripts, getScriptWorker, page, script } from "@demiurgejs/core";

const WORKER_BUSY_MS = 600;

type TimedWindow = Window & {
  __demiurgeBusyEndedAt?: number;
  __demiurgeEagerTagLoadedAt?: number;
  __demiurgeIdleTagLoadedAt?: number;
};

type Timings = {
  busyEndedAt?: number;
  eagerLoadedAt?: number;
  hydratedAt?: number;
  idleLoadedAt?: number;
  mainThreadResumedAt?: number;
  workerFinishedAt?: number;
  workerStartedAt?: number;
};

type WorkerReport = {
  finishedAt: number;
  startedAt: number;
};

// Three strategies, three loading behaviours. The afterInteractive tag loads
// while the browser parses the document. The idle tag waits for an idle
// period. The worker task never touches the main thread at all.
export const scripts = defineScripts([
  script({
    async: true,
    id: "eager-tag",
    src: "/vendor/eager-tag",
    strategy: "afterInteractive",
  }),
  script({ id: "idle-tag", src: "/vendor/idle-tag", strategy: "idle" }),
  script({ id: "worker-task", src: "/vendor/worker-task", strategy: "worker" }),
]);

function StrategiesPage() {
  const [timings, setTimings] = useState<Timings>({});

  useEffect(() => {
    setTimings((current) => ({ ...current, hydratedAt: Date.now() }));
  }, []);

  useEffect(() => {
    const timed = window as TimedWindow;
    const interval = setInterval(() => {
      const busyEndedAt = timed.__demiurgeBusyEndedAt;
      const eagerLoadedAt = timed.__demiurgeEagerTagLoadedAt;
      const idleLoadedAt = timed.__demiurgeIdleTagLoadedAt;

      if (busyEndedAt && eagerLoadedAt && idleLoadedAt) {
        setTimings((current) => ({
          ...current,
          busyEndedAt,
          eagerLoadedAt,
          idleLoadedAt,
        }));
        clearInterval(interval);
      }
    }, 25);

    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    const worker = getScriptWorker("/vendor/worker-task");

    if (!worker) {
      return;
    }

    function onMessage(event: MessageEvent<WorkerReport>) {
      setTimings((current) => ({
        ...current,
        workerFinishedAt: event.data.finishedAt,
        workerStartedAt: event.data.startedAt,
      }));
    }

    worker.addEventListener("message", onMessage);
    worker.postMessage({ busyMs: WORKER_BUSY_MS });

    // The worker is busy from this point. A main thread task that runs before
    // the worker reports back proves the work left the main thread.
    const timer = setTimeout(() => {
      setTimings((current) => ({ ...current, mainThreadResumedAt: Date.now() }));
    }, 0);

    return () => {
      clearTimeout(timer);
      worker.removeEventListener("message", onMessage);
    };
  }, []);

  return (
    <main>
      <h1 data-testid="strategies-heading">Script strategies</h1>
      <p data-testid="hydrated-at">{timings.hydratedAt ?? ""}</p>
      <p data-testid="busy-ended-at">{timings.busyEndedAt ?? ""}</p>
      <p data-testid="eager-loaded-at">{timings.eagerLoadedAt ?? ""}</p>
      <p data-testid="idle-loaded-at">{timings.idleLoadedAt ?? ""}</p>
      <p data-testid="worker-started-at">{timings.workerStartedAt ?? ""}</p>
      <p data-testid="worker-finished-at">{timings.workerFinishedAt ?? ""}</p>
      <p data-testid="main-thread-resumed-at">
        {timings.mainThreadResumedAt ?? ""}
      </p>
    </main>
  );
}

export const GET = page({
  view: StrategiesPage,
});

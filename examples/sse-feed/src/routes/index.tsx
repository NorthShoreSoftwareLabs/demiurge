import { useEffect, useState } from "react";
import { page } from "@demiurgejs/core";

type FeedTick = { tick: number };

function FeedPage() {
  const [ticks, setTicks] = useState<FeedTick[]>([]);
  const [connections, setConnections] = useState(0);

  useEffect(() => {
    const source = new EventSource("/api/feed");

    source.addEventListener("open", () => {
      setConnections((count) => count + 1);
    });

    source.addEventListener("tick", (event) => {
      const payload = JSON.parse((event as MessageEvent).data) as FeedTick;
      setTicks((previous) => [...previous, payload].slice(-20));
    });

    return () => source.close();
  }, []);

  return (
    <main>
      <h1>Live SSE feed</h1>
      <p>
        <code>/api/feed</code> closes its stream every few ticks. The browser
        {" "}
        <code>EventSource</code> reconnects on its own and resumes the count
        from the last event ID it saw.
      </p>
      <p data-connections={connections} data-testid="connections">
        Connections opened: {connections}
      </p>
      <ul className="feed" data-testid="feed">
        {ticks.map((item, index) => (
          <li data-tick={item.tick} key={`${item.tick}-${index}`}>
            Tick {item.tick}
          </li>
        ))}
      </ul>
    </main>
  );
}

export const GET = page({
  view: FeedPage,
});

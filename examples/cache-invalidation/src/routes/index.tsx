import { page, type RouteProps } from "@demiurgejs/core";
import { cache, messageQuery } from "../cache";

type MessageData = {
  message: string;
  sourceReads: number;
};

export const GET = page<string, MessageData>({
  data: () => cache.get(messageQuery()),
  view: MessagePage,
});

function MessagePage({ data }: RouteProps<"/", MessageData>) {
  return (
    <main>
      <section className="summary">
        <p className="eyebrow">Tag invalidation from an action</p>
        <h1>Cache invalidation</h1>
        <div className="message">
          <p data-testid="message">{data.message}</p>
          <p>
            Source reads:{" "}
            <strong data-testid="source-reads">{data.sourceReads}</strong>
          </p>
        </div>
        <p className="description">
          Reloading this page alone reuses the cached message and never
          advances the source read counter. Submitting the form below writes a
          new message, then invalidates the "message" tag so the next read
          reaches the source again.
        </p>
      </section>

      <form action="/api/message" method="post">
        <label htmlFor="message">New message</label>
        <input defaultValue={data.message} id="message" name="message" />
        <button type="submit">Update and invalidate</button>
      </form>
    </main>
  );
}

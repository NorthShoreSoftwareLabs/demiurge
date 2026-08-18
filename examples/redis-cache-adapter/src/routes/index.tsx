import { Link, page } from "@demiurgejs/core";

export const GET = page(() => (
  <main>
    <p className="eyebrow">Shared Redis cache</p>
    <h1>Redis-backed public data</h1>
    <p>
      Each post below loads through a `public` cache scope backed by{" "}
      <code>createRedisCacheStore</code>. Reload a post to see its load count
      hold steady while the entry is cached, then invalidate it to see the
      count advance again.
    </p>
    <ul>
      <li>
        <Link to="/posts/[id]" path={{ id: "1" }}>Post 1</Link>
      </li>
      <li>
        <Link to="/posts/[id]" path={{ id: "2" }}>Post 2</Link>
      </li>
    </ul>
    <p>
      Bust a post&apos;s cache entry with{" "}
      <code>{'POST /api/invalidate {"tag":"posts"}'}</code> or{" "}
      <code>{'{"tag":"post:1"}'}</code> for a single post.
    </p>
  </main>
));

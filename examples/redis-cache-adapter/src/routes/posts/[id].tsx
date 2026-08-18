import {
  httpError,
  Link,
  page,
  query,
  tag,
  type RouteProps,
} from "@demiurgejs/core";

type Post = { body: string; id: string; title: string };
type PostPageData = { loadCount: number; post: Post };

// Stands in for a database. The route's cache entry, not this table, is what
// each test request actually exercises.
const posts: Record<string, Post> = {
  "1": {
    body: "createRedisCacheStore shares public entries across every "
      + "process that talks to the same Redis database.",
    id: "1",
    title: "Redis-backed caching",
  },
  "2": {
    body: "invalidateTags deletes every entry carrying a tag in one "
      + "atomic Lua script, visible to every connected process at once.",
    id: "2",
    title: "Tag-based invalidation",
  },
};

// Incremented only when the backing loader actually runs. A cache hit
// returns the stored value without touching this counter. The number the
// page renders is proof of a miss, not just proof of a request.
let loadCount = 0;

const postQuery = query({
  fn: (id: string) => loadPost(id),
  key: (id: string) => ["redis-cache-adapter", "post", id],
  scope: "public",
  tags: (id: string) => [tag("posts"), tag(`post:${id}`)],
  ttl: "1h",
});

export const GET = page<"/posts/[id]", PostPageData>({
  async data({ cache, path }) {
    const post = await cache.get(postQuery(path.id));
    return { loadCount, post };
  },
  view: PostPage,
});

function PostPage({ data }: RouteProps<"/posts/[id]", PostPageData>) {
  return (
    <main>
      <p className="eyebrow">Post {data.post.id}</p>
      <h1 data-testid="post-title">{data.post.title}</h1>
      <p>{data.post.body}</p>
      <p className="load-count" data-load-count={data.loadCount} data-testid="load-count">
        Backing load count: {data.loadCount}
      </p>
      <Link to="/">Back home</Link>
    </main>
  );
}

async function loadPost(id: string) {
  const post = posts[id];

  if (!post) {
    throw httpError(404, `No post ${id}.`);
  }

  // A small delay stands in for a real database round trip. It makes the
  // cache's hit path (no delay) distinguishable from its miss path in timing.
  await new Promise((resolve) => setTimeout(resolve, 20));
  loadCount += 1;
  return post;
}

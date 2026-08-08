# Data And Static Generation

## Data Primitives

Demiurge should avoid making data loading feel separate from route handling.
A page `GET` is still a `GET`; data is part of producing that response.

Recommended page shape:

```ts
export const GET = page({
  render: { mode: "ssr" },

  data: async ({ path, cache }) => ({
    post: await cache.get(postBySlug(path.slug)),
  }),

  view: ({ data }) => <PostPage post={data.post} />,
});
```

`data` is optional. React Server Components may fetch data inside the component
tree instead:

```tsx
async function PostPage({ slug }: { slug: string }) {
  const post = await cache.get(postBySlug(slug));
  return <Post post={post} />;
}
```

Both route-level and component-level data should use the same request-aware
framework primitives so caching, dedupe, cancellation, tracing, and invalidation
work consistently.

The first route-level slice supports `page({ data, view })` during route
loading. `data` receives the matched request context, including `path`,
`pathname`, `request`, `search`, `url`, and a request-scoped framework `cache`.
Loaded route matches carry the resolved `data` value for the page renderer.
SSR payloads, static generation, and hydration variants still need dedicated
wiring.

## Query Objects

Reusable data should be represented as typed query objects:

```ts
export const postBySlug = query({
  key: (slug: string) => ["post", slug],
  tags: (slug) => [tags.posts(), tags.post({ slug })],
  ttl: "10m",
  scope: "public",
  fn: async (slug) => db.posts.findBySlug(slug),
});
```

Then it can be used from route data, metadata, layouts, route handlers, and
server components:

```ts
const post = await cache.get(postBySlug(path.slug));
```

The first data slice exposes `query(...)`, `createMemoryCache(...)`, `tag(...)`,
and `defineTags(...)`. Query objects produce typed cache requests with stable
keys, tags, TTLs, and scopes. The memory cache supports request dedupe, shared
build/public/private entries, `none` bypass, TTL expiry, and key/tag
invalidation.

## Render Timing And Data Timing

Default rule:

> Page data runs in the same phase as the page render unless explicitly declared
> otherwise.

| Render mode | Default data timing | Notes |
| --- | --- | --- |
| `static` | build time | One run per generated path. |
| `ssr` | request time | Can use request, cookies, headers, and runtime cache. |
| `rsc` | server render request time | Component-level server data is common. |
| `spa` | client or explicit server call | Server data must come through API/server functions or prerendered payloads. |

## Cache API

Cache use should be explicit:

```ts
const post = await cache.get({
  key: ["post", slug],
  tags: [tags.posts(), tags.post({ slug })],
  scope: "public",
  ttl: "5m",
  staleWhileRevalidate: "1h",
  fn: () => cms.post(slug),
});
```

Cache scopes:

```ts
type CacheScope =
  | "build"
  | "public"
  | "private"
  | "request"
  | "none";
```

- `build`: build-process cache for static generation.
- `public`: shared across users; must not depend on cookies/session/auth.
- `private`: user-specific.
- `request`: dedupe only inside the current request/render.
- `none`: always run the source function.

The framework should detect dangerous combinations, such as reading cookies or
session data and then writing a `public` cache entry.

## Cache Backend

The configured cache backend is for framework cache semantics, not arbitrary app
storage.

```ts
export default defineConfig({
  cache: cache.redis({
    url: process.env.REDIS_URL,
    namespace: "demiurge",
  }),
});
```

The app should receive a structured cache API, not the raw Redis/KV client.

Allowed:

```ts
await cache.get(postBySlug(slug));
```

Avoid:

```ts
await cache.redis.set("whatever", value);
```

If users need app-level derived caching, provide typed cache domains instead of
raw adapter access:

```ts
export const recommendationsCache = defineCacheDomain("recommendations", {
  scope: "private",
  ttl: "5m",
});
```

## Invalidation

Server-side invalidation:

```ts
invalidate.tags([tags.posts()]);
invalidate.path("/posts");
invalidate.key(["post", slug]);
```

Client-side React should not mutate the shared cache directly. Client code calls
typed actions or server functions:

```tsx
const createPost = useAction(actions.posts.create);
await createPost.submit({ title: "Hello" });
```

The server action performs invalidation:

```ts
export const create = action({
  input: PostInput,

  async handler({ input, invalidate, routes }) {
    const post = await db.posts.create(input);
    invalidate.tags([tags.posts()]);
    return redirect({ to: "/posts/[slug]", path: { slug: post.slug } });
  },
});
```

Client router refresh/prefetch and server data-cache invalidation should be
separate concepts.

## Typed Routes, Redirects, And Tags

Route files should generate a typed route manifest:

```ts
href("/")
href("/posts")
href({ to: "/posts/[slug]", path: { slug } })
href({ to: "/org/[orgId]/settings", path: { orgId } })
```

Use it everywhere:

```tsx
<Link to="/posts/[slug]" path={{ slug }}>Read post</Link>
```

```ts
return redirect({ to: "/posts/[slug]", path: { slug } });
invalidate.path({ to: "/posts/[slug]", path: { slug } });
```

Cache tags should also be typed:

```ts
export const tags = defineTags({
  posts: tag<void>("posts"),
  post: tag<{ slug: string }>((input) => `post:${input.slug}`),
});
```

## Static Generation

Static sites need to turn dynamic route patterns into concrete paths at build
time.

For a route:

```txt
routes/blog/[slug].ts
```

the framework needs:

```ts
[{ slug: "hello-world" }, { slug: "file-routing" }]
```

Then it can emit:

```txt
dist/blog/hello-world/index.html
dist/blog/file-routing/index.html
```

The simplest API is probably a plain `paths` export:

```ts
export const paths = async ({ cache }) => {
  const posts = await cache.get(allPostSlugsQuery());
  return posts.map((post) => ({ slug: post.slug }));
};

export const GET = page({
  render: { mode: "static" },
  data: async ({ path, cache }) => ({
    post: await cache.get(postBySlug(path.slug)),
  }),
  view: ({ data }) => <PostPage post={data.post} />,
});
```

This is more precise than `params` and more minimal than
`defineStaticParams(...)`. Add a helper only if it unlocks better inference or
validation.

The first static paths slice exposes the typed `paths` route export and a
validated framework collector for static adapters. The collector includes
non-dynamic page routes automatically, requires dynamic page routes to export
`paths`, validates every dynamic and catchall variable, and expands entries into
encoded concrete pathnames. It does not yet emit static HTML artifacts.

Use this vocabulary:

- `path`: runtime variables extracted from dynamic path segments.
- `paths`: build-time list of concrete dynamic path variable sets to generate.
- `search`: URL search parameters from the query string.

Avoid using `params` in public APIs unless there is a very specific reason.

### Paginated Archive Pages

Pagination here means generated archive URLs, not paginating the build itself:

```txt
/blog/page/1
/blog/page/2
/blog/page/3
```

For:

```txt
routes/blog/page/[page].ts
```

the route can return:

```ts
export const paths = async () => {
  const totalPosts = await cms.countPosts();
  const pages = Math.ceil(totalPosts / 20);

  return Array.from({ length: pages }, (_, index) => ({
    page: String(index + 1),
  }));
};
```

If a CMS API itself is paginated, the user can loop inside `paths`. That is data
source logic, not a separate framework primitive.

## Prior Art

- Next.js uses `generateStaticParams()` for dynamic routes and runs it before
  corresponding layouts/pages during build.
- Astro requires `getStaticPaths()` for dynamic routes in static mode.
- SvelteKit prerenders by crawling entry points and supports an `entries`
  function for dynamic routes.
- Gatsby can create dynamic pages through its File System Route API or the
  programmatic `createPages` Node API.

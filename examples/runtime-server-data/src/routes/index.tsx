import { httpError, page, query, type RouteProps } from "demiurge";

type SourceSample = {
  channel: string;
  count: number;
  generatedAt: string;
};

type RuntimeData = {
  account: string;
  privateSample: SourceSample;
  publicSample: SourceSample;
  requestSamples: [SourceSample, SourceSample];
  uncachedSamples: [SourceSample, SourceSample];
};

const publicSample = query({
  fn: (origin: string) => loadSource(origin, "public"),
  key: (_origin: string) => ["runtime-source", "public"],
  scope: "public",
  ttl: "2s",
});

const privateSample = query({
  fn: (origin: string, account: string) =>
    loadSource(origin, `private:${account}`),
  key: (_origin: string, account: string) => [
    "runtime-source",
    "private",
    account,
  ],
  scope: "private",
  ttl: "30s",
});

const requestSample = query({
  fn: (origin: string) => loadSource(origin, "request"),
  key: (_origin: string) => ["runtime-source", "request"],
  scope: "request",
});

const uncachedSample = query({
  fn: (origin: string) => loadSource(origin, "none"),
  key: (_origin: string) => ["runtime-source", "none"],
  scope: "none",
});

export const GET = page<string, RuntimeData>({
  async data({ cache, request, url }) {
    const account = request.headers.get("x-demo-account") ?? "guest";
    const [
      loadedPublic,
      loadedPrivate,
      requestFirst,
      requestSecond,
      uncachedFirst,
      uncachedSecond,
    ] = await Promise.all([
      cache.get(publicSample(url.origin)),
      cache.get(privateSample(url.origin, account)),
      cache.get(requestSample(url.origin)),
      cache.get(requestSample(url.origin)),
      cache.get(uncachedSample(url.origin)),
      cache.get(uncachedSample(url.origin)),
    ]);

    return {
      account,
      privateSample: loadedPrivate,
      publicSample: loadedPublic,
      requestSamples: [requestFirst, requestSecond],
      uncachedSamples: [uncachedFirst, uncachedSecond],
    };
  },
  view: RuntimeDataPage,
});

function RuntimeDataPage({ data }: RouteProps<"/", RuntimeData>) {
  return (
    <main>
      <section className="summary">
        <p className="eyebrow">Live source counters</p>
        <h1>One request, four cache contracts</h1>
        <p>
          Account partition: <strong>{data.account}</strong>
        </p>
      </section>

      <dl className="scope-grid">
        <ScopeResult
          description="Shared until its two-second TTL expires."
          label="Public"
          sample={data.publicSample}
          testId="public"
        />
        <ScopeResult
          description="Shared for this account; the account is part of the key."
          label="Private"
          sample={data.privateSample}
          testId="private"
        />
        <ScopeResult
          description="Two reads dedupe inside this request only."
          label="Request"
          sample={data.requestSamples[0]}
          secondary={data.requestSamples[1]}
          testId="request"
        />
        <ScopeResult
          description="Two reads always reach the source."
          label="None"
          sample={data.uncachedSamples[0]}
          secondary={data.uncachedSamples[1]}
          testId="none"
        />
      </dl>
    </main>
  );
}

function ScopeResult({
  description,
  label,
  sample,
  secondary,
  testId,
}: {
  description: string;
  label: string;
  sample: SourceSample;
  secondary?: SourceSample;
  testId: string;
}) {
  return (
    <div className="scope-result">
      <dt>{label}</dt>
      <dd
        data-channel={sample.channel}
        data-count={sample.count}
        data-testid={testId}
      >
        Source call {sample.count}
        {secondary ? (
          <span data-secondary-count={secondary.count}>
            Second read: {secondary.count}
          </span>
        ) : null}
      </dd>
      <dd className="description">{description}</dd>
    </div>
  );
}

async function loadSource(origin: string, channel: string) {
  const url = new URL("/api/source", origin);
  url.searchParams.set("channel", channel);
  const response = await fetch(url);

  if (!response.ok) {
    throw httpError(502, `Runtime data source returned ${response.status}.`);
  }

  return await response.json() as SourceSample;
}

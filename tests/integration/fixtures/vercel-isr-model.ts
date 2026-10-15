import assert from "node:assert/strict";

type Identity = { path: string; representation: "document" | "navigation" };
type Entry = { response: Response; refreshAt: number };

// This deterministic model tests assumptions before a live provider probe.
class PrivateProviderModel {
  now = 0;
  readonly entries = new Map<string, Entry>();
  readonly pending = new Map<string, Promise<void>>();

  constructor(readonly generate: (identity: Identity) => Promise<Response>) {}

  async request(identity: Identity): Promise<Response> {
    const key = JSON.stringify(identity);
    const entry = this.entries.get(key);
    if (entry) {
      if (entry.refreshAt <= this.now) void this.regenerate(identity);
      return entry.response.clone();
    }
    await this.regenerate(identity);
    const generated = this.entries.get(key);
    if (!generated) throw new Error("The model generation failed.");
    return generated.response.clone();
  }

  regenerate(identity: Identity): Promise<void> {
    const key = JSON.stringify(identity);
    const existing = this.pending.get(key);
    if (existing) return existing;
    const operation = Promise.resolve().then(async () => {
      try {
        const response = await this.generate(identity);
        if (!response.ok) throw new Error("The model generation failed.");
        this.entries.set(key, { response, refreshAt: this.now + 60 });
      } catch {
        const previous = this.entries.get(key);
        if (previous) previous.refreshAt = this.now + 30;
      }
    }).finally(() => { this.pending.delete(key); });
    this.pending.set(key, operation);
    return operation;
  }

  invalidate(identity: Identity): "acknowledged" {
    void this.regenerate(identity);
    return "acknowledged";
  }

  async settle(): Promise<void> {
    await Promise.all(this.pending.values());
  }
}

export async function verifyProviderModel(): Promise<void> {
  let version = 1;
  let calls = 0;
  let fail = false;
  const model = new PrivateProviderModel(async ({ representation }) => {
    calls += 1;
    if (fail) throw new Error("Private source details.");
    return new Response(`${representation}:${version}`);
  });
  const document: Identity = { path: "/products/alpha", representation: "document" };
  const navigation: Identity = { ...document, representation: "navigation" };
  assert.equal(await (await model.request(document)).text(), "document:1");
  version = 2;
  assert.equal(await (await model.request(document)).text(), "document:1");
  assert.equal(calls, 1);
  assert.equal(await (await model.request(navigation)).text(), "navigation:2");
  assert.equal(await (await model.request({ ...document, path: "/products/beta" })).text(), "document:2");
  assert.equal(calls, 3);

  model.now = 60;
  assert.equal(await (await model.request(document)).text(), "document:1");
  await model.settle();
  assert.equal(await (await model.request(document)).text(), "document:2");
  model.now = 120;
  fail = true;
  assert.equal(await (await model.request(document)).text(), "document:2");
  await model.settle();
  const failedCalls = calls;
  model.now = 149;
  assert.equal(await (await model.request(document)).text(), "document:2");
  assert.equal(calls, failedCalls);
  model.now = 150;
  fail = false;
  version = 3;
  await model.request(document);
  await model.settle();
  assert.equal(await (await model.request(document)).text(), "document:3");

  const started = barrier();
  const release = barrier();
  let held = false;
  const concurrent = new PrivateProviderModel(async ({ representation }) => {
    const captured = version;
    if (held && representation === "document") {
      started.resolve();
      await release.promise;
    }
    return new Response(`${representation}:${captured}`);
  });
  await concurrent.request(document);
  await concurrent.request(navigation);
  held = true;
  version = 4;
  assert.equal(concurrent.invalidate(document), "acknowledged");
  await started.promise;
  version = 5;
  assert.equal(concurrent.invalidate(document), "acknowledged");
  assert.equal(concurrent.invalidate(navigation), "acknowledged");
  release.resolve();
  await concurrent.settle();
  assert.equal(await (await concurrent.request(document)).text(), "document:4");
  assert.equal(await (await concurrent.request(navigation)).text(), "navigation:5");

  let mutations = 0;
  mutations += 1;
  const deliver = async (loseAcknowledgment: boolean) => {
    const acknowledgment = concurrent.invalidate(document);
    await concurrent.settle();
    return loseAcknowledgment ? "acceptance-unknown" : acknowledgment;
  };
  assert.equal(await deliver(true), "acceptance-unknown");
  assert.equal(await deliver(false), "acknowledged");
  assert.equal(mutations, 1);
  assert.equal(await (await concurrent.request(document)).text(), "document:5");
}

function barrier() {
  let resolve!: () => void;
  const promise = new Promise<void>((complete) => { resolve = complete; });
  return { promise, resolve };
}

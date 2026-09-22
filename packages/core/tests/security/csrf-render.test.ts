import { describe, expect, it } from "vitest";
import { createCsrfRenderState } from "../../src/security/csrf-render";

describe("CSRF render state", () => {
  it("permits a preissued token after headers and rejects a new cookie name", () => {
    const state = createCsrfRenderState(new Request("https://example.test/"));
    const token = state.context.token();

    state.seal();

    expect(state.context.token()).toBe(token);
    expect(() => state.context.token({ cookie: "custom-csrf" })).toThrow(
      "cannot first render after streaming response headers",
    );
    expect(state.used()).toBe(true);
  });
});

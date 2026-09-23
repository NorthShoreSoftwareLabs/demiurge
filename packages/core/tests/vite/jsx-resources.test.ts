import { describe, expect, it } from "vitest";
import { extractDocumentResources } from "../../src/vite/jsx-resources";

const file = "/app/src/routes/@layout.tsx";

describe("JSX document resource extraction", () => {
  it("extracts literal external and inline resources", async () => {
    const resources = await extractDocumentResources(`
export default function Layout() {
  return <>
    <script src="https://scripts.example.com/app.js" />
    <link rel="preload stylesheet" href={'https://styles.example.com/app.css'} />
    <script>{\`start()\`}</script>
    <style>{\`@import url("https://fonts.example.com/type.css"); body { color: red; }\`}</style>
  </>;
}`, file);

    expect(resources).toEqual([
      { file, kind: "external-script", value: "https://scripts.example.com/app.js" },
      { file, kind: "external-stylesheet", value: "https://styles.example.com/app.css" },
      { file, kind: "inline-script", value: "start()" },
      {
        file,
        kind: "inline-style",
        value: '@import url("https://fonts.example.com/type.css"); body { color: red; }',
      },
      { file, kind: "style-import", value: "https://fonts.example.com/type.css" },
    ]);
  });

  it("accepts template literals without expressions and CSS import forms", async () => {
    const resources = await extractDocumentResources(`
export default () => <>
  <script src={\`https://scripts.example.com/app.js\`} />
  <link rel={\`stylesheet\`} href={\`https://styles.example.com/app.css\`} />
  <style>{\`@import 'https://one.example/a.css'; @import url(https://two.example/b.css);\`}</style>
</>;`, file);

    expect(resources.map(({ kind, value }) => ({ kind, value }))).toEqual([
      { kind: "external-script", value: "https://scripts.example.com/app.js" },
      { kind: "external-stylesheet", value: "https://styles.example.com/app.css" },
      {
        kind: "inline-style",
        value: "@import 'https://one.example/a.css'; @import url(https://two.example/b.css);",
      },
      { kind: "style-import", value: "https://one.example/a.css" },
      { kind: "style-import", value: "https://two.example/b.css" },
    ]);
  });

  it("skips dynamic, spread, computed, and helper component resources", async () => {
    const resources = await extractDocumentResources(`
const src = "https://scripts.example.com/app.js";
const props = { src };
const name = "src";
function Script(props) { return <script {...props} />; }
export default () => <>
  <script src={src} />
  <script {...props} />
  <script {...{ [name]: "https://computed.example/app.js" }} />
  <link rel="stylesheet" href={\`https://styles.example.com/\${src}\`} />
  <style>{src}</style>
  <Script src="https://helper.example/app.js" />
</>;`, file);

    expect(resources).toEqual([]);
  });

  it("ignores non-stylesheet links and non-TSX files", async () => {
    await expect(
      extractDocumentResources(
        `export default () => <link rel="icon" href="/icon.svg" />;`,
        file,
      ),
    ).resolves.toEqual([]);
    await expect(
      extractDocumentResources(`export const value = "<script>bad()</script>";`, "/app/route.ts"),
    ).resolves.toEqual([]);
  });

  it("records literal and unreadable inline nonces", async () => {
    const resources = await extractDocumentResources(`
const nonce = getNonce();
export default () => <>
  <script nonce="fixed">{'fixed()'}</script>
  <style nonce={nonce}>{'body { color: red; }'}</style>
</>;`, file);

    expect(resources).toEqual([
      { file, kind: "inline-script", nonce: "fixed", value: "fixed()" },
      {
        file,
        kind: "inline-style",
        nonceUnknown: true,
        value: "body { color: red; }",
      },
    ]);
  });

  it("records nonce metadata for external scripts", async () => {
    const resources = await extractDocumentResources(`
const nonce = getNonce();
export default () => <>
  <script nonce="fixed" src="https://scripts.example.com/fixed.js" />
  <script nonce={nonce} src="https://scripts.example.com/dynamic.js" />
</>;`, file);

    expect(resources).toEqual([
      {
        file,
        kind: "external-script",
        nonce: "fixed",
        value: "https://scripts.example.com/fixed.js",
      },
      {
        file,
        kind: "external-script",
        nonceUnknown: true,
        value: "https://scripts.example.com/dynamic.js",
      },
    ]);
  });
});

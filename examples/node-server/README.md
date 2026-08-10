# Demiurge Node Server

This example builds a client bundle and an SSR server bundle, then serves both
through the production Node adapter.

```sh
npm run build
NODE_ENV=production npm start
```

The server serves hashed client assets and the emitted stylesheet from
`dist/client`, while page requests are rendered through the framework-owned SSR
server entry. The root page includes server-loaded data, and `/api/items`
remains a regular JSON route.

The client build emits `dist/client/demiurge-manifest.json`; `server.js` reads
its hashed entry and stylesheet paths and passes them to the generated
`createHandler(...)`. The SSR build compiles `src/server-entry.ts` to
`dist/server/server-entry.js`.

Deploy `dist/client`, `dist/server`, `server.js`, `package.json`, and installed
production dependencies together. The server defaults to `127.0.0.1:4173`.
Override `PORT` as needed and set `HOST=0.0.0.0` when a container or platform
must connect directly to the process.

# Demiurge Node Server

This example builds a client bundle and an SSR server bundle, then serves both
through the production Node adapter.

```sh
npm run build
npm start
```

The server serves hashed client assets and the emitted stylesheet from
`dist/client`, while page requests are rendered through the framework-owned SSR
server entry. The root page includes server-loaded data, and `/api/items`
remains a regular JSON route.

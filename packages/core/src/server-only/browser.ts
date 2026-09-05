export {};

// A browser build resolves the "browser" condition of the
// "@demiurgejs/core/server-only" package export to this file. A build that
// reaches this file put a server-only module in a browser bundle. The error
// on evaluation stops that bundle from running.
throw new Error(
  'Demiurge found a server-only module in a browser bundle. Remove the import of "@demiurgejs/core/server-only" from client code, or move the server logic to a module that no client module imports.',
);

# create-demiurge

Create a Demiurge application with an editable starting point.

## Usage

Run the interactive command:

```sh
npm create demiurge
```

Pass a directory and template for non-interactive use:

```sh
npm create demiurge my-app -- --template page
npm create demiurge my-api -- --template api
```

The page template includes a layout, fallback documents, a policy, styles, and
a page route. The fallback documents use plain markup without fallback styles.

The API template includes a policy and a health route. It does not include page
routes, layouts, fallback documents, or styles.

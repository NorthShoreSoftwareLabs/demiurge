# Static inspection

Demiurge answers a question about a route without a request. The
`demiurge inspect` command reads the route tree, resolves the policy cascade,
and writes one JSON document. A developer or an agent reads the document and
learns what the framework decided.

[ADR 0019](../../architecture/decisions/0019-versioned-inspection-interfaces.md)
records this decision.

## Run the command

```sh
demiurge inspect
```

The command writes the JSON report to standard output. It writes a human
summary to standard error. A pipe therefore receives the JSON alone:

```sh
demiurge inspect > report.json
demiurge inspect | jq '.findings'
```

The command accepts no argument. It reads `demiurge.config.ts` from the project
root, and it reads the route directory that the configuration names.

## The command runs no application code

The command reads each route file as source. It loads no route module, so it
runs no data loader and no mutation handler. A report therefore states what the
build knows, and it never changes application state.

The command and the development server call the same functions. The command
answers for the build, and the
[route audit panel](./devtools.md) answers for one request.

## Exit codes

| Code | Condition |
| --- | --- |
| `0` | The report holds no finding with error severity |
| `1` | The report holds at least one finding with error severity |
| `2` | The command received an invalid argument, or Demiurge could not read the configuration |

The command writes a problem document to standard output for exit code 2. The
document states a `code`, a `title`, a `detail`, and a `version`.

## The report

```json
{
  "findings": [],
  "redactions": [],
  "request": ["authorization-result", "cookie-values"],
  "resolutions": {
    "findings": "static",
    "redactions": "static",
    "request": "request",
    "routes": "static"
  },
  "routes": [
    {
      "declaredAccess": "declared",
      "declaredDocumentCsp": "present",
      "declaresDocumentPolicy": true,
      "file": "index.tsx",
      "kind": "page",
      "methods": ["GET"],
      "pattern": "/"
    }
  ],
  "routesDir": "src/routes",
  "version": 1
}
```

Each `routes` entry states what one route file declares. The `findings` section
states the result of the policy cascade of the complete route tree.

The report is deterministic. Two runs over the same route tree give the same
document and the same exit code.

## The version field

Each report states a `version` field that holds an integer. Read this field
before you parse a report.

- Demiurge raises the integer when it removes a field.
- Demiurge raises the integer when it changes the meaning of a field.
- Demiurge does not raise the integer when it adds a field.

The route report, the static policy report, and the problem document each carry
their own version.

## The resolution field

The `resolutions` record states the origin of each section of a report.

- The value `static` states that the build knows the facts of the section.
- The value `request` states that only a request supplies the facts.

The `request` section names the facts that need a running application. Read the
route audit panel of the development server to get those facts.

## Secret redaction

One function serializes each report, and that function removes a secret value.
A value is secret when one of these statements is true.

- An environment declaration created the value through `env.secret(...)`.
- A session record holds the value.
- A cookie holds the value.

The serializer replaces the value with the text `[redacted]`. The `redactions`
section then states the name of the field, the path of the field, and the
reason. The report never states the value.

## Related

- [Route audit panel](./devtools.md) reports one request.
- [Security guide](./security.md) describes the policy declarations.

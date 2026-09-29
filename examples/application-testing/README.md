# Application testing

This example tests a Demiurge application through public package exports.
The tests send requests through the production route pipeline.
They also inspect the generated static output.

Run the suite with this command:

```sh
pnpm --filter @demiurge-examples/application-testing test
```

Vitest owns the test lifecycle and assertions in this example.
See the [application testing guide](../../docs/guides/application-testing.md) for other test runner options.

The adversarial framework suite has different responsibilities.
See GitHub issue [#409](https://github.com/NorthShoreSoftwareLabs/demiurge/issues/409) for that work.

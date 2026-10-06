import { Link, page } from "@demiurgejs/core";

export const GET = page({
  view: () => (
    <main>
      <h1>Security boundaries under hostile input</h1>
      <p>
        This application gives each security guarantee one observable route.
        Tests use production output and public package exports.
      </p>
      <ul>
        <li><Link to="/secure/record">Authorization and private data</Link></li>
        <li><Link to="/redirects">Mutation redirect validation</Link></li>
      </ul>
    </main>
  ),
});

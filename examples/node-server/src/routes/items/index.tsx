import { Link, page } from "demiurge";

const items = ["alpha", "beta", "gamma"];

export const GET = page(() => (
  <main>
    <h1>Items</h1>
    <ul>
      {items.map((item) => (
        <li key={item}>
          <Link to="/items/[id]" path={{ id: item }}>
            {item}
          </Link>
        </li>
      ))}
    </ul>
  </main>
));

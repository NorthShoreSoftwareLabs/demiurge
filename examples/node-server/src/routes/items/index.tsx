import { Link, page, type RouteProps } from "demiurge";

type ItemsData = { items: string[] };

export const GET = page({
  async data({ request }) {
    const response = await fetch(new URL("/api/items", request.url), {
      headers: { accept: "application/json" },
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`Items upstream returned ${response.status}.`);
    }

    return await response.json() as ItemsData;
  },
  view: ItemsPage,
});

function ItemsPage({ data }: RouteProps<"/items", ItemsData>) {
  return (
    <main>
      <h1>Items</h1>
      <ul>
        {data.items.map((item) => (
          <li key={item}>
            <Link to="/items/[id]" path={{ id: item }}>
              {item}
            </Link>
          </li>
        ))}
      </ul>
    </main>
  );
}

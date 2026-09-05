import { Link, page, type RouteProps } from "@demiurgejs/core";

type ItemsData = { items: string[] };

export const GET = page({
  publicData: true,
  async data({ request }) {
    const response = await fetch(new URL("/api/items", request.url), {
      headers: { accept: "application/json" },
      signal: request.signal,
    });

    if (!response.ok) {
      throw new Error(`Items upstream returned ${response.status}.`);
    }

    // TYPE-EVIDENCE: The items endpoint returns the typed items payload after the successful response check.
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

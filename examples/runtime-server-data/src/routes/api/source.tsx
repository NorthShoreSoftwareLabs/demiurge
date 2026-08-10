import { httpError, json } from "demiurge";

const sourceCounts = new Map<string, number>();

export const GET = json(({ search }) => {
  const channel = search.get("channel");

  if (!channel) {
    throw httpError(400, "The source channel is required.");
  }

  const count = (sourceCounts.get(channel) ?? 0) + 1;
  sourceCounts.set(channel, count);

  return {
    channel,
    count,
    generatedAt: new Date().toISOString(),
  };
});

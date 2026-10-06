export type FixturePrincipal = {
  tenant: string;
  userId: string;
};

export type FixtureContext = {
  principal?: FixturePrincipal;
};

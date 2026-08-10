// Where a request failed decides what the caller gets. A 500 is not one thing,
// and neither is the reporting: a fallback renderer needs to say which site it
// was speaking for.
export type FailureSite = "middleware" | "page" | "route";

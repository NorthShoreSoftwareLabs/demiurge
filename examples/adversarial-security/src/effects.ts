let acceptedBodies = 0;

export function countAcceptedBody() {
  acceptedBodies += 1;
  return acceptedBodies;
}

export function readAcceptedBodyCount() {
  return acceptedBodies;
}

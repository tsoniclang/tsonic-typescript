const exactObjectIdentities = new WeakMap<object, number>();
let nextExactObjectIdentity = 1;

export function exactObjectIdentity(value: object): number {
  const existing = exactObjectIdentities.get(value);
  if (existing !== undefined) {
    return existing;
  }
  const created = nextExactObjectIdentity;
  nextExactObjectIdentity += 1;
  exactObjectIdentities.set(value, created);
  return created;
}

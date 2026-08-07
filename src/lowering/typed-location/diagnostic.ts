export class TypedLocationLoweringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TypedLocationLoweringError";
  }
}

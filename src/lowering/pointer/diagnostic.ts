export class PointerLoweringError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "PointerLoweringError";
  }
}

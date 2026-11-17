// One error type for everything a client could hit. The message is plain words
// a business owner can read; `fix` says what to do next.
export class KitError extends Error {
  constructor(code, message, fix) {
    super(message);
    this.code = code;
    this.fix = fix;
  }
}

declare module 'fernet' {
  export class Secret {
    constructor(secret: string);
  }
  export class Token {
    constructor(opts: { secret: Secret; token?: string; ttl?: number; time?: number; iv?: number[] });
    decode(): string;
    encode(message: string): string;
  }
  const _default: { Secret: typeof Secret; Token: typeof Token };
  export default _default;
}

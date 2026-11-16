// Shared by the framework adapters (ai-sdk, langchain): one lazily created redactor and a small memory of masked texts,
// so the unchanged history of a conversation is masked once.
import { createRedactor, type RedactOptions, type Redactor, type RedactorOptions } from "./redactor.js";

export interface MaskerOptions {
  /** A redactor you already have (or its promise). Without it one is created from `create` on the first model call. */
  redactor?: Redactor | Promise<Redactor>;
  /** Options for `createRedactor` when no `redactor` is given (size, sensitivity, allow, block, modelUrl, ...). */
  create?: RedactorOptions;
  /** How a span is replaced: `mode` "tag" (default, `[EMAIL]`), "mask" or "blank", or `replace`. */
  redact?: RedactOptions;
}

const CACHE_MAX = 256;

export function createMasker(options: MaskerOptions): (text: string) => Promise<string> {
  let redactor: Promise<Redactor> | undefined = options.redactor === undefined ? undefined : Promise.resolve(options.redactor);
  const cache = new Map<string, Promise<string>>();
  return (text) => {
    if (text === "") return Promise.resolve(text);
    let out = cache.get(text);
    if (out !== undefined) {
      cache.delete(text); // most recently used last
    } else {
      redactor ??= createRedactor(options.create);
      out = redactor.then((r) => r.redact(text, options.redact)).then((r) => r.text);
      out.catch(() => cache.delete(text)); // a failed call is not remembered
    }
    cache.set(text, out);
    if (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value as string);
    return out;
  };
}

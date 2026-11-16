// Vercel AI SDK: a language model middleware that masks personal information in the prompt before the model call.
//
//   import { wrapLanguageModel, generateText } from "ai";
//   import { piiMiddleware } from "@newmean-ai/pii/ai-sdk";
//
//   const model = wrapLanguageModel({ model: openai("gpt-6.1"), middleware: piiMiddleware() });
//   await generateText({ model, prompt: "Call Kim Minsu on 010-1234-5678" });  // the provider gets "Call [PERSON] on [PHONE]"
//
// The `ai` package is not a dependency: the middleware is a plain object in the shape `wrapLanguageModel` takes, and the
// prompt is read structurally (messages with a role and a string or an array of parts), the same in provider
// specifications v2, v3 and v4.
import { createMasker, type MaskerOptions } from "./masker.js";

export type PiiRole = "system" | "user" | "assistant" | "tool";

export interface PiiMiddlewareOptions extends MaskerOptions {
  /** Message roles to mask. Default `["user"]`. "tool" masks the text outputs of tool results (JSON outputs are left as they
   *  are); "assistant" and "system" mask those messages' text. */
  roles?: readonly PiiRole[];
  /** The middleware's `specificationVersion`. Default "v3" (AI SDK 6 and 7); pass "v2" for AI SDK 5. */
  specificationVersion?: string;
}

export interface PiiMiddleware<V extends string = "v3"> {
  readonly specificationVersion: V;
  /** Returns the call parameters with the chosen roles' text masked. The input is not changed. */
  transformParams<P>(options: { params: P }): Promise<P>;
}

type Part = { type?: unknown; text?: unknown; output?: { type?: unknown; value?: unknown } };
type Message = { role?: unknown; content?: unknown };

export function piiMiddleware<V extends string = "v3">(options: PiiMiddlewareOptions & { specificationVersion?: V } = {}): PiiMiddleware<V> {
  const roles = new Set<string>(options.roles ?? ["user"]);
  const mask = createMasker(options);

  const maskPart = async (part: Part): Promise<Part> => {
    if (part === null || typeof part !== "object") return part;
    if (part.type === "text" && typeof part.text === "string") return { ...part, text: await mask(part.text) };
    const o = part.output;
    if (part.type === "tool-result" && o && o.type === "text" && typeof o.value === "string")
      return { ...part, output: { ...o, value: await mask(o.value) } };
    return part;
  };

  const maskMessage = async (message: Message): Promise<Message> => {
    if (message === null || typeof message !== "object" || !roles.has(message.role as string)) return message;
    const { content } = message;
    if (typeof content === "string") return { ...message, content: await mask(content) };
    if (Array.isArray(content)) return { ...message, content: await Promise.all(content.map(maskPart)) };
    return message;
  };

  return {
    specificationVersion: (options.specificationVersion ?? "v3") as V,
    async transformParams<P>({ params }: { params: P }): Promise<P> {
      const prompt = (params as { prompt?: unknown } | null)?.prompt;
      if (!Array.isArray(prompt)) return params;
      return { ...params, prompt: await Promise.all(prompt.map(maskMessage)) };
    },
  };
}

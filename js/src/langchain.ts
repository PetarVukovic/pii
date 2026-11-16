// LangChain.js (langchain >= 1.0): an agent middleware that masks personal information in the messages of each model call.
//
//   import { createAgent } from "langchain";
//   import { piiMiddleware } from "@newmean-ai/pii/langchain";
//
//   const agent = createAgent({ model: "openai:gpt-6.1", middleware: [piiMiddleware()] });
//   // "Call Kim Minsu on 010-1234-5678" reaches the model as "Call [PERSON] on [PHONE]"
//
// LangChain's own piiMiddleware takes a synchronous detector, and this package's model call is asynchronous, so this is a
// middleware of its own. It wraps the model call: the model gets masked copies, and the agent's state keeps the messages
// as they were written. `langchain` is an optional peer dependency, needed only for this entry.
import { AIMessage, createMiddleware, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import { createMasker, type MaskerOptions } from "./masker.js";

export type PiiMessageRole = "user" | "assistant" | "tool";

export interface PiiMiddlewareOptions extends MaskerOptions {
  /** Message kinds to mask. Default `["user"]`; "tool" masks tool results, "assistant" earlier model answers. */
  roles?: readonly PiiMessageRole[];
}

type Content = BaseMessage["content"];

export function piiMiddleware(options: PiiMiddlewareOptions = {}) {
  const roles = new Set<PiiMessageRole>(options.roles ?? ["user"]);
  const mask = createMasker(options);

  const maskContent = async (content: Content): Promise<Content> => {
    if (typeof content === "string") return mask(content);
    if (!Array.isArray(content)) return content;
    return Promise.all(
      content.map(async (block) => {
        const b = block as { type?: unknown; text?: unknown };
        return b && b.type === "text" && typeof b.text === "string" ? { ...block, text: await mask(b.text) } : block;
      }),
    ) as Promise<Content>;
  };

  const maskMessage = async (m: BaseMessage): Promise<BaseMessage> => {
    const role: PiiMessageRole | null = HumanMessage.isInstance(m) ? "user" : ToolMessage.isInstance(m) ? "tool" : AIMessage.isInstance(m) ? "assistant" : null;
    if (role === null || !roles.has(role)) return m;
    const content = await maskContent(m.content);
    if (content === m.content || JSON.stringify(content) === JSON.stringify(m.content)) return m;
    const base = { content, id: m.id, name: m.name, additional_kwargs: m.additional_kwargs, response_metadata: m.response_metadata };
    if (ToolMessage.isInstance(m)) return new ToolMessage({ ...base, tool_call_id: m.tool_call_id, status: m.status, artifact: m.artifact } as ConstructorParameters<typeof ToolMessage>[0]);
    if (AIMessage.isInstance(m))
      return new AIMessage({ ...base, tool_calls: m.tool_calls, invalid_tool_calls: m.invalid_tool_calls, usage_metadata: m.usage_metadata } as ConstructorParameters<typeof AIMessage>[0]);
    return new HumanMessage(base as ConstructorParameters<typeof HumanMessage>[0]);
  };

  return createMiddleware({
    name: "NewmeanPiiMiddleware",
    wrapModelCall: async (request, handler) => handler({ ...request, messages: await Promise.all(request.messages.map(maskMessage)) }),
  });
}

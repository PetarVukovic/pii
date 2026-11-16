import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { AIMessage, createAgent, HumanMessage, ToolMessage, type BaseMessage } from "langchain";
import { FakeListChatModel } from "@langchain/core/utils/testing";
import { piiMiddleware } from "../src/langchain";
import type { Redactor } from "../src/redactor";

const MODELS = process.env.PII_MODELS ?? new URL("./models/", import.meta.url).pathname;
const localFetch = (async (url: string) => new Response(readFileSync(url.replace("file://", "")))) as unknown as typeof fetch;

// a redactor that masks every digit run, so the message handling is tested without a model
const digits = { redact: async (text: string) => ({ text: text.replace(/\d+/g, "[N]"), spans: [] }) } as unknown as Redactor;

// what the model is called with, through the middleware's own hook
const run = async (mw: ReturnType<typeof piiMiddleware>, messages: BaseMessage[]) => {
  let seen: BaseMessage[] = [];
  const hook = mw.wrapModelCall as unknown as (request: object, handler: (r: { messages: BaseMessage[] }) => Promise<AIMessage>) => Promise<AIMessage>;
  await hook({ messages, systemPrompt: "keep 1" }, async (r) => ((seen = r.messages), new AIMessage("ok")));
  return seen;
};

describe("piiMiddleware (message handling)", () => {
  const history = () => [
    new HumanMessage({ content: "my number is 42", id: "h1", name: "kim" }),
    new AIMessage({ content: "noted 42", id: "a1", tool_calls: [{ id: "c1", name: "t", args: { n: 42 } }] }),
    new ToolMessage({ content: "row 9", id: "t1", tool_call_id: "c1" }),
    new HumanMessage({ content: [{ type: "text", text: "and 7" }, { type: "image_url", image_url: "data:x" }], id: "h2" }),
    new HumanMessage({ content: "no number", id: "h3" }),
  ];

  it("masks user messages only by default, keeps ids and other fields, and leaves the originals", async () => {
    const messages = history();
    const seen = await run(piiMiddleware({ redactor: digits }), messages);
    expect(seen.map((m) => m.content)).toEqual([
      "my number is [N]",
      "noted 42",
      "row 9",
      [{ type: "text", text: "and [N]" }, { type: "image_url", image_url: "data:x" }],
      "no number",
    ]);
    expect([seen[0].id, seen[0].name, HumanMessage.isInstance(seen[0])]).toEqual(["h1", "kim", true]);
    expect(seen[4]).toBe(messages[4]); // unchanged messages are passed as they are
    expect(messages[0].content).toBe("my number is 42");
  });

  it("masks tool results and assistant messages when asked", async () => {
    const seen = await run(piiMiddleware({ redactor: digits, roles: ["tool", "assistant"] }), history());
    expect(seen[0].content).toBe("my number is 42");
    expect(seen[1].content).toBe("noted [N]");
    expect((seen[1] as AIMessage).tool_calls).toEqual([expect.objectContaining({ id: "c1", name: "t", args: { n: 42 } })]);
    expect([seen[2].content, (seen[2] as ToolMessage).tool_call_id, ToolMessage.isInstance(seen[2])]).toEqual(["row [N]", "c1", true]);
  });
});

describe.skipIf(!existsSync(`${MODELS}/pii-nano/onnx/model_q4.onnx`))("piiMiddleware in an agent with the nano model", () => {
  it("the model gets the masked text and the agent's state keeps the original", async () => {
    const seen: string[] = [];
    class Model extends FakeListChatModel {
      async _generate(messages: BaseMessage[], ...rest: [any, any?]) {
        seen.push(String(messages[messages.length - 1].content));
        return super._generate(messages, ...rest);
      }
      bindTools() {
        return this; // the stock fake returns a new instance, which would drop this subclass
      }
    }
    const create = { size: "nano" as const, modelUrl: `file://${MODELS}/pii-nano/`, fetch: localFetch, cache: false };
    const agent = createAgent({ model: new Model({ responses: ["ok"] }), tools: [], middleware: [piiMiddleware({ create })] });
    const text = "Please call Kim Minsu on 010-1234-5678 or write to kim@example.com.";
    const out = await agent.invoke({ messages: [new HumanMessage(text)] });
    expect(seen).toHaveLength(1);
    expect(seen[0]).toContain("[EMAIL]");
    expect(seen[0]).not.toContain("010-1234-5678");
    expect(out.messages[0].content).toBe(text);
  });
});

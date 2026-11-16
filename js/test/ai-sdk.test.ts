import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { piiMiddleware } from "../src/ai-sdk";
import { createRedactor, type Redactor } from "../src/redactor";

const MODELS = process.env.PII_MODELS ?? new URL("./models/", import.meta.url).pathname;
const localFetch = (async (url: string) => new Response(readFileSync(url.replace("file://", "")))) as unknown as typeof fetch;
const TEXT = "Please call Kim Minsu on 010-1234-5678 or write to kim@example.com.";

// a redactor that masks every digit run, so the prompt handling is tested without a model
const digits = (calls: string[] = []): Redactor =>
  ({
    async redact(text: string, o?: { mode?: string }) {
      calls.push(text);
      return { text: text.replace(/\d+/g, o?.mode === "mask" ? "*" : "[N]"), spans: [] };
    },
  }) as unknown as Redactor;

const prompt = () => [
  { role: "system", content: "Line 1 of the system prompt" },
  { role: "user", content: [{ type: "text", text: "my number is 42" }, { type: "file", data: "7", mediaType: "text/plain" }] },
  { role: "assistant", content: [{ type: "text", text: "noted 42" }, { type: "tool-call", toolCallId: "c1", toolName: "t", input: { n: 42 } }] },
  {
    role: "tool",
    content: [
      { type: "tool-result", toolCallId: "c1", toolName: "t", output: { type: "text", value: "row 9" } },
      { type: "tool-result", toolCallId: "c2", toolName: "t", output: { type: "json", value: { n: 9 } } },
    ],
  },
];

describe("piiMiddleware (prompt handling)", () => {
  it("masks user text only by default and leaves the input untouched", async () => {
    const params = { prompt: prompt(), temperature: 0 };
    const out = await piiMiddleware({ redactor: digits() }).transformParams({ params });
    expect(params.prompt).toEqual(prompt());
    expect(out.temperature).toBe(0);
    const want = prompt();
    (want[1].content as any)[0].text = "my number is [N]";
    expect(out.prompt).toEqual(want);
  });

  it("masks the roles asked for: system strings, assistant text, text tool results (not JSON ones)", async () => {
    const mw = piiMiddleware({ redactor: digits(), roles: ["system", "assistant", "tool"], redact: { mode: "mask" } });
    const out = (await mw.transformParams({ params: { prompt: prompt() } })).prompt as any[];
    expect(out[0].content).toBe("Line * of the system prompt");
    expect(out[1].content[0].text).toBe("my number is 42");
    expect(out[2].content[0].text).toBe("noted *");
    expect(out[2].content[1].input).toEqual({ n: 42 });
    expect(out[3].content[0].output).toEqual({ type: "text", value: "row *" });
    expect(out[3].content[1].output).toEqual({ type: "json", value: { n: 9 } });
  });

  it("masks an unchanged message once across calls, and passes through params without a prompt", async () => {
    const calls: string[] = [];
    const mw = piiMiddleware({ redactor: digits(calls) });
    const user = (text: string) => ({ role: "user", content: [{ type: "text", text }] });
    await mw.transformParams({ params: { prompt: [user("a 1")] } });
    await mw.transformParams({ params: { prompt: [user("a 1"), user("b 2"), user("")] } });
    expect(calls).toEqual(["a 1", "b 2"]);
    const other = { input: "x" };
    expect(await mw.transformParams({ params: other })).toBe(other);
  });

  it("has the specification version asked for and does not remember a failed call", async () => {
    expect(piiMiddleware().specificationVersion).toBe("v3");
    expect(piiMiddleware({ specificationVersion: "v2" }).specificationVersion).toBe("v2");
    let fail = true;
    const flaky = { redact: async (t: string) => (fail ? Promise.reject(new Error("load")) : { text: t.toUpperCase(), spans: [] }) } as unknown as Redactor;
    const mw = piiMiddleware({ redactor: flaky });
    const params = { prompt: [{ role: "user", content: [{ type: "text", text: "abc" }] }] };
    await expect(mw.transformParams({ params })).rejects.toThrow("load");
    fail = false;
    expect(((await mw.transformParams({ params })).prompt[0].content[0] as any).text).toBe("ABC");
  });
});

describe.skipIf(!existsSync(`${MODELS}/pii-nano/onnx/model_q4.onnx`))("piiMiddleware with the nano model", () => {
  it("gives the model the text redact() gives, creating the redactor from `create`", async () => {
    const create = { size: "nano" as const, modelUrl: `file://${MODELS}/pii-nano/`, fetch: localFetch, cache: false };
    const out = await piiMiddleware({ create }).transformParams({ params: { prompt: [{ role: "user", content: [{ type: "text", text: TEXT }] }] } });
    const got = (out.prompt[0].content[0] as any).text as string;
    const r = await createRedactor(create);
    expect(got).toBe((await r.redact(TEXT)).text);
    expect(got).toContain("[EMAIL]");
    expect(got).not.toContain("010-1234-5678");
    await r.dispose();
  });
});

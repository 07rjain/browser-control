import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, it } from "vitest";
import { encodeNativeMessage, LengthPrefixedJsonDecoder } from "../bridge/protocol.mjs";
import { stopProbeProcess } from "../scripts/probe-process.mjs";

it("interrupts a pending tool once across both native Stop paths and blocks a late step", async () => {
  const home = mkdtempSync(join(tmpdir(), "codex-sidebar-smoke-stop-"));
  const trace = join(home, "trace.jsonl");
  writeFileSync(join(home, "codex.mjs"), `import { appendFileSync } from "node:fs";
import { createInterface } from "node:readline";
const send = message => process.stdout.write(JSON.stringify(message)+"\\n");
let running = false;
createInterface({input:process.stdin}).on("line",line=>{
 const message=JSON.parse(line); appendFileSync(${JSON.stringify(trace)}, JSON.stringify(message)+"\\n");
 if(!message.method || message.id===undefined)return;
 let result={};
 if(message.method==="initialize")result={userAgent:"fixture/0"};
 if(message.method==="skills/list")result={data:[]};
 if(message.method==="thread/start")result={thread:{id:"parent"},model:"fixture"};
 if(message.method==="turn/start"){
   running=true;
   send({method:"turn/started",params:{threadId:"parent",turn:{id:"turn"}}});
   result={turn:{id:"turn"}};
   send({id:message.id,result});
   send({id:900,method:"item/tool/call",params:{threadId:"parent",turnId:"turn",callId:"customer-two",namespace:"page",tool:"fill",arguments:{}}});
   return;
 }
 if(message.method==="turn/interrupt"){
   if(!running){send({id:message.id,error:{message:"no active turn to interrupt"}});return;}
   running=false;
   send({method:"turn/completed",params:{threadId:"parent",turn:{id:"turn",status:"interrupted"}}});
   send({id:901,method:"item/tool/call",params:{threadId:"parent",turnId:"turn",callId:"late-customer-three",namespace:"page",tool:"fill",arguments:{}}});
 }
 send({id:message.id,result});
});`);
  writeFileSync(join(home, "codex.cmd"), '"%~dp0codex.mjs" %*\r\n');
  const host = spawn(process.execPath, [fileURLToPath(new URL("../bridge/native-host.mjs", import.meta.url))], {
    env: { ...process.env, BROWSER_CONTROL_TEST_HOME: "1", CODEX_SIDEBAR_HOME: home, CODEX_BIN: join(home, "codex.cmd") },
    stdio: ["pipe", "pipe", "pipe"], windowsHide: true,
  });
  const decoder = new LengthPrefixedJsonDecoder(), pending = new Map(), events = [];
  host.stderr.resume();
  host.stdout.on("data", chunk => {
    for (const message of decoder.push(chunk)) {
      if (message.type === "event") events.push(message);
      if (message.type === "response") { pending.get(message.id)?.(message); pending.delete(message.id); }
    }
  });
  function request(method, params) {
    return new Promise((done, fail) => {
      const id = randomUUID(); const timer = setTimeout(() => { pending.delete(id); fail(new Error(`Timed out: ${method}`)); }, 5000);
      pending.set(id, message => { clearTimeout(timer); if (message.ok) done(message.data); else fail(new Error(message.error)); });
      host.stdin.write(encodeNativeMessage({ type: "request", id, method, params }));
    });
  }
  try {
    await request("chat.start", {});
    const params = { threadId: "parent", clientMessageId: randomUUID(), userText: "Fill five test customers" };
    await request("chat.send", params);
    await expect.poll(() => events.filter(event => event.event === "tool.request").length).toBe(1);
    await Promise.all([request("chat.cancelSend", params), request("chat.interrupt", { threadId: "parent", turnId: "turn" })]);
    await request("chat.interrupt", { threadId: "parent", turnId: "turn" });
    const messages = readFileSync(trace, "utf8").trim().split("\n").map(line => JSON.parse(line));
    expect(messages.filter(message => message.method === "turn/interrupt")).toHaveLength(1);
    await expect.poll(() => readFileSync(trace, "utf8")).toContain('"id":901,"result":{"success":false');
    expect(events.filter(event => event.event === "tool.request").map(event => event.data.callId)).toEqual(["customer-two"]);
    expect(events).toContainEqual(expect.objectContaining({ event: "chat.turnCompleted", data: expect.objectContaining({ turn: expect.objectContaining({ status: "interrupted" }) }) }));
  } finally {
    await stopProbeProcess(host);
    rmSync(home, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  }
});

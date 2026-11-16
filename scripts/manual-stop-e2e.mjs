/* global chrome, window, document */
// Opt-in live-account check. Uses real Codex inference and a disposable local form.
// No videos, external form submissions, or account/credential logging.
import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { setTimeout as delay } from "node:timers/promises";
import { chromium } from "playwright";
if (!process.argv.includes("--live-account")) throw new Error("Explicit --live-account is required (uses Codex account quota).");
const root = mkdtempSync(join(tmpdir(), "browser-control-stop-e2e-"));
const extension = join(root, "extension");
cpSync(resolve("dist"), extension, { recursive: true });
const manifestPath = join(extension, "manifest.json");
const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
manifest.host_permissions = ["http://127.0.0.1/*"];
writeFileSync(manifestPath, JSON.stringify(manifest));
writeFileSync(join(extension, "probe.html"), "<!doctype html><title>Stop test probe</title>");
const fixtureHtml = `<!doctype html><title>Disposable five-customer form</title><h1>Local Stop regression fixture</h1>
<p>Disposable test data only. Fill each customer's row in order. Save each row before proceeding to the next.</p>
<div id="rows"></div><ol id="saved"></ol>
<script>
const names=['Asha','Ravi','Leena','Noor','Maya'];window.mutations=[];window.saved=[];
rows.innerHTML=names.map((name,i)=>'<form aria-label="'+name+' test customer"><h2>'+name+'</h2><label>Test name '+(i+1)+' <input aria-label="Test name '+(i+1)+'"></label><label>Test city '+(i+1)+' <input aria-label="Test city '+(i+1)+'"></label><button>Save '+name+'</button></form>').join('');
for(const [i,form] of [...document.forms].entries()) {
 form.addEventListener('input',e=>{window.mutations.push({row:i,field:e.target.ariaLabel,value:e.target.value,at:Date.now()});});
 form.addEventListener('submit',e=>{e.preventDefault();window.saved.push(names[i]);document.getElementById('saved').textContent=window.saved.join(', ');form.querySelector('button').disabled=true;});
}
</script>`;
const server = createServer((_request,response)=>{response.setHeader("Content-Type","text/html");response.end(fixtureHtml);});
let context;
const report = { version: manifest.version, scenarios: [] };
try {
  await new Promise(resolveListen => server.listen(0,"127.0.0.1",resolveListen));
  mkdirSync(join(root,"profile","NativeMessagingHosts"),{recursive:true});
  cpSync(join(homedir(),".config","chromium","NativeMessagingHosts","com.codex.sidebar.json"),join(root,"profile","NativeMessagingHosts","com.codex.sidebar.json"));
  context = await chromium.launchPersistentContext(join(root,"profile"), {
    channel:"chromium", headless:false,
    args:[`--disable-extensions-except=${extension}`,`--load-extension=${extension}`],
  });
  report.browser = context.browser().version();
  const worker = context.serviceWorkers()[0] ?? await context.waitForEvent("serviceworker");
  const workerErrors=[];
  worker.on("console",message=>{if(message.type()==="error")workerErrors.push(message.text());});
  await worker.evaluate(async ()=>{
    await chrome.storage.local.set({codexSidebarTaskControlOrigins:["http://127.0.0.1/*"],codexSidebarBrowserPermissionMode:"ask"});
    globalThis.stopNativeEvidence=[];
    const connect=chrome.runtime.connectNative.bind(chrome.runtime);
    chrome.runtime.connectNative=(...args)=>{
      const port=connect(...args);
      port.onMessage.addListener(message=>{
        if(message.type==="event" && ["tool.request","chat.turnCompleted","chat.error"].includes(message.event)) globalThis.stopNativeEvidence.push(message);
      });
      const post=port.postMessage.bind(port);
      port.postMessage=message=>{if(["chat.send","chat.interrupt","chat.cancelSend"].includes(message.method))globalThis.stopNativeEvidence.push({method:message.method,params:message.params});return post(message);};
      return port;
    };
  });
  const id=worker.url().split("/")[2];
  assert.equal(id,"mpdfhhhjgbpdpfnkjbnboebdjokfjglf");
  const probe=await context.newPage();await probe.goto(`chrome-extension://${id}/probe.html`);
  const fixture=await context.newPage();const origin=`http://127.0.0.1:${server.address().port}`;
  await fixture.goto(origin);
  await worker.evaluate(origin=>chrome.storage.local.set({codexSidebarTaskControlOrigins:[origin+"/*"]}),origin);
  const [{windowId}]=await worker.evaluate(()=>chrome.tabs.query({active:true,currentWindow:true}));
  const probeSession=await context.newCDPSession(probe);
  await probeSession.send("Runtime.evaluate",{expression:`chrome.sidePanel.open({windowId:${windowId}})`,userGesture:true,awaitPromise:true});
  const browserSession = await context.browser().newBrowserCDPSession();
  let panel;
  for (let attempt = 0; attempt < 100 && !panel; attempt++) {
    panel = (await browserSession.send("Target.getTargets")).targetInfos.find(({ url }) => url === `chrome-extension://${id}/sidepanel.html`);
    if (!panel) await delay(100);
  }
  assert.ok(panel, "The actual extension side panel did not open.");
  const { sessionId } = await browserSession.send("Target.attachToTarget", { targetId: panel.targetId, flatten: false });
  const pending = new Map();
  let nextId = 0;
  const consoleErrors = [];
  browserSession.on("Target.receivedMessageFromTarget", (event) => {
    if (event.sessionId !== sessionId) return;
    const message = JSON.parse(event.message);
    if (message.method === "Runtime.exceptionThrown") consoleErrors.push(message.params.exceptionDetails.text);
    if (message.method === "Runtime.consoleAPICalled" && message.params.type === "error") consoleErrors.push(JSON.stringify(message.params.args));
    const request = pending.get(message.id);
    if (!request) return;
    pending.delete(message.id);
    clearTimeout(request.timer);
    if (message.error) request.reject(new Error(JSON.stringify(message.error)));
    else request.resolve(message.result);
  });
  const send = (method, params = {}) => new Promise((resolveRequest, reject) => {
    const requestId = ++nextId;
    const timer = setTimeout(() => { pending.delete(requestId); reject(new Error(`Side panel ${method} timed out.`)); }, 10_000);
    pending.set(requestId, { resolve: resolveRequest, reject, timer });
    browserSession.send("Target.sendMessageToTarget", { sessionId, message: JSON.stringify({ id: requestId, method, params }) }).catch((error) => {
      clearTimeout(timer); pending.delete(requestId); reject(error);
    });
  });
  await send("Runtime.enable");
  const evaluate = async (expression) => {
    const result = await send("Runtime.evaluate", { expression, userGesture: true, awaitPromise: true, returnByValue: true });
    if (result.exceptionDetails) throw new Error(JSON.stringify(result.exceptionDetails));
    return result.result?.value;
  };
  const waitFor = async (expression, description) => {
    for (let attempt = 0; attempt < 600; attempt++) {
      if (await evaluate(expression)) return;
      await delay(100);
    }
    throw new Error(`${description}\n${await evaluate("document.body.innerText")}`);
  };
  const click = async (selector) => {
    await waitFor(`Boolean(document.querySelector(${JSON.stringify(selector)}))`, `Missing ${selector}`);
    await evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
  };
  await waitFor("Boolean(document.querySelector('[aria-label=\"Message Browser Control\"]'))", "Real signed-in composer unavailable");
  const liveWait = async (check, description, timeout=180_000) => {
    const started=Date.now();
    let lastStatus=started;
    while(Date.now()-started<timeout){
      if(await check())return;
      if(Date.now()-lastStatus>30_000){console.log(`Waiting: ${description}`);writeFileSync("/tmp/browser-control-stop-panel.txt",await evaluate("document.body.innerText"));lastStatus=Date.now();}
      await delay(100);
    }
    throw new Error(`${description}\n${await evaluate("document.body.innerText")}`);
  };
  const prompt="On the current disposable local test page, fill and save all five customers in order. Use each row's heading for its Test name, and Pune for Test city. Save each row before starting the next. Do not touch any other tab.";
  const submit=async()=>{
    await evaluate(`(()=>{const input=document.querySelector('[aria-label="Message Browser Control"]');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(input,${JSON.stringify(prompt)});input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await click('[aria-label="Send message"]');
  };
  // Exact reported failure: Stop while the agent is awaiting form approval.
  await submit();
  await liveWait(async()=>await evaluate("Boolean(document.querySelector('[aria-labelledby=\"approval-title\"]'))"),"No real form approval appeared");
  report.scenarios.push({name:"pending form submission",before:await fixture.evaluate(()=>({mutations:window.mutations,saved:window.saved}))});
  await click('[aria-label="Stop response"]');
  await liveWait(async()=> (await evaluate("document.body.innerText")).includes("Stopped."),"Stop confirmation missing",30_000);
  await delay(4_000);
  assert.equal(await fixture.evaluate(()=>window.saved.length),0);
  assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Stop response\"]'))"),false);
  assert.ok(!(await evaluate("document.body.innerText")).includes("no active turn"));
  report.scenarios.at(-1).after=await fixture.evaluate(()=>({mutations:window.mutations,saved:window.saved}));
  console.log("PASS: real agent stopped at pending submission, no form saved.");
  // Mid-task: switch only this isolated profile to Full access and Stop when
  // the second customer's first field is filled. All saves remain localhost.
  await worker.evaluate(()=>chrome.storage.local.set({codexSidebarBrowserPermissionMode:"full"}));
  await click('[aria-label="Start a new chat"]');
  await fixture.reload();
  // Hold the second customer's input handler for three seconds so Stop is
  // pressed during a real page.fill call, rather than after a fast batch.
  let secondInputStartedAt=0;
  await fixture.exposeFunction("reportInputStart",startedAt=>{secondInputStartedAt=startedAt;});
  await fixture.evaluate(()=>document.forms[1].addEventListener("input",()=>{
    const startedAt=Date.now();void window.reportInputStart(startedAt);
    const until=performance.now()+3000;while(performance.now()<until){/* bounded fixture delay */}
  }));
  await submit();
  await liveWait(async()=>secondInputStartedAt>0,"Agent did not begin the second customer fill");
  const stopPressedAt=Date.now();
  assert.ok(stopPressedAt-secondInputStartedAt<3000,"Stop did not occur during the held page.fill");
  const before={pendingTool:"page.fill",customer:"Ravi",fixtureInputDelayMs:3000,secondInputStartedAt,stopPressedAt};
  await click('[aria-label="Stop response"]');
  await liveWait(async()=> (await evaluate("document.body.innerText")).includes("Stopped."),"Mid-task Stop confirmation missing",30_000);
  const atStop=await fixture.evaluate(()=>({mutations:window.mutations,saved:window.saved}));
  await delay(8_000);
  const after=await fixture.evaluate(()=>({mutations:window.mutations,saved:window.saved}));
  assert.deepEqual(after,atStop,"Page changed after Stop completed");
  assert.deepEqual(after.saved,["Asha"],"Second customer was saved after Stop");
  assert.ok(!after.mutations.some(change=>change.row>=2),"Agent continued to customer three after Stop");
  assert.equal(await evaluate("Boolean(document.querySelector('[aria-label=\"Stop response\"]'))"),false);
  assert.ok(!(await evaluate("document.body.innerText")).includes("no active turn"));
  report.scenarios.push({name:"second customer mid-task",before,atStop,after});
  report.nativeEvidence=await worker.evaluate(()=>globalThis.stopNativeEvidence);
  report.panelText=await evaluate("document.body.innerText");
  report.consoleErrors={worker:workerErrors,panel:consoleErrors};
  assert.deepEqual(report.consoleErrors,{worker:[],panel:[]});
  writeFileSync("/tmp/browser-control-stop-e2e.json",JSON.stringify(report,null,2));
  console.log("PASS: real mid-task Stop; first customer saved, later customers untouched; no console errors. Evidence: /tmp/browser-control-stop-e2e.json");
} catch(error) {
  if(context) for(const worker of context.serviceWorkers()) {
    try{report.nativeEvidence=await worker.evaluate(()=>globalThis.stopNativeEvidence);}catch{/* closed */}
  }
  report.error=String(error);writeFileSync("/tmp/browser-control-stop-e2e.json",JSON.stringify(report,null,2));throw error;
} finally {await context?.close();await new Promise(resolveClose=>server.close(resolveClose));rmSync(root,{recursive:true,force:true});}

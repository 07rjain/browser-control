import { probeCodexReviewerTools } from "./probe-codex-tools.mjs";
import { probeReviewerConcurrency } from "./reviewer-compatibility.mjs";

for (const model of ["gpt-6-luna", "gpt-6.1-sol", "gpt-6-astra", "probe-unknown-model"]) {
  const result = await probeCodexReviewerTools(process.env.CODEX_BIN || "codex", model);
  process.stdout.write(`Reviewer tool isolation passed for ${model}: ${JSON.stringify(result.names)}; user-input requests are rejected by the companion.\n`);
}
process.stdout.write(`Concurrent reviewer probe: ${JSON.stringify(await probeReviewerConcurrency(process.env.CODEX_BIN || "codex"))}\n`);

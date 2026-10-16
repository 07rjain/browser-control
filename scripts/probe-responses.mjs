import { randomUUID } from "node:crypto";

export function streamResponse(response, item, model) {
  response.writeHead(200, { "content-type": "text/event-stream", "cache-control": "no-cache" });
  let sequence = 0;
  const event = (type, data) => response.write(`event: ${type}\ndata: ${JSON.stringify({ type, sequence_number: sequence++, ...data })}\n\n`);
  const completed = { id: `resp_${randomUUID()}`, object: "response", status: "completed", model, output: [item], usage: { input_tokens: 10, output_tokens: 10, total_tokens: 20 } };
  event("response.created", { response: { ...completed, status: "in_progress", output: [] } });
  event("response.output_item.added", { output_index: 0, item: { ...item, ...(item.type === "message" ? { content: [] } : { arguments: "" }) } });
  if (item.type === "message") {
    event("response.content_part.added", { item_id: item.id, output_index: 0, content_index: 0, part: { type: "output_text", text: "", annotations: [] } });
    event("response.output_text.delta", { item_id: item.id, output_index: 0, content_index: 0, delta: item.content[0].text });
    event("response.output_text.done", { item_id: item.id, output_index: 0, content_index: 0, text: item.content[0].text });
    event("response.content_part.done", { item_id: item.id, output_index: 0, content_index: 0, part: item.content[0] });
  } else {
    event("response.function_call_arguments.delta", { item_id: item.id, output_index: 0, delta: item.arguments });
    event("response.function_call_arguments.done", { item_id: item.id, output_index: 0, arguments: item.arguments });
  }
  event("response.output_item.done", { output_index: 0, item });
  event("response.completed", { response: completed });
  response.end();
}

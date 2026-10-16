import { createServer } from "node:http";

// Disposable manual-test page. It stores nothing and contacts no external service.
const server = createServer((request, response) => {
  const url = new URL(request.url, "http://127.0.0.1:9845");
  if (!["/", "/search"].includes(url.pathname)) { response.writeHead(404); response.end(); return; }
  const searched = url.pathname === "/search" && url.searchParams.get("q") === "blue otter";
  response.writeHead(200, { "content-type": "text/html; charset=utf-8", "cache-control": "no-store", "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'" });
  response.end(`<!doctype html><html lang="en"><meta charset="utf-8"><title>Auto review disposable test</title><style>body{font:20px system-ui;margin:64px;max-width:650px}input,button{font:inherit;padding:12px;margin:8px 0}label{display:block}output{display:block;margin-top:32px}</style><h1>Auto review disposable test</h1><p>This local page stores nothing. The form searches only this disposable fixture.</p><form role="search" aria-label="Search" action="/search" method="get"><label>Search terms<input name="q" value="${searched ? "blue otter" : ""}"></label><button type="submit">Search</button></form><output>${searched ? "Search complete: blue otter" : "No search submitted."}</output></html>`);
});
server.listen(9845, "127.0.0.1", () => process.stdout.write("Disposable Auto review fixture: http://127.0.0.1:9845/\n"));

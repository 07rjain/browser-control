import net from "node:net";

export function localhostCallbackPort(authUrl) {
  if (typeof authUrl !== "string" || authUrl.length === 0) return null;
  let url;
  try {
    url = new URL(authUrl);
  } catch {
    return null;
  }
  const candidates = [url];
  for (const value of url.searchParams.values()) {
    try {
      candidates.push(new URL(value));
    } catch {
      // Query values are not all URLs.
    }
  }
  for (const candidate of candidates) {
    if (candidate.hostname !== "localhost") continue;
    const port = Number(candidate.port);
    if (Number.isInteger(port) && port > 0 && port < 65536) return port;
  }
  return null;
}

export function startIpv4LoginProxy(port) {
  const server = net.createServer((socket) => {
    const target = net.connect({ host: "127.0.0.1", port });
    const closeBoth = () => {
      socket.destroy();
      target.destroy();
    };
    target.on("error", closeBoth);
    socket.on("error", closeBoth);
    target.once("connect", () => {
      socket.pipe(target);
      target.pipe(socket);
    });
  });
  server.on("error", () => undefined);
  server.listen({ host: "::1", port, ipv6Only: true });
  return server;
}

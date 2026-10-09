import { createHash, randomBytes, randomUUID } from "node:crypto";

const authorizationEndpoint = "https://auth.openai.com/api/accounts/authorize";
const redirects = {
  documentedLoopback: "http://127.0.0.1:1455/auth/callback",
  chromeExtension: "https://aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.chromiumapp.org/auth/callback",
};

const requestedUrl = process.argv[2];
if (requestedUrl === "--browser-url") {
  console.log(authorizationUrl(redirects.chromeExtension).toString());
  process.exit(0);
}

function authorizationUrl(redirectUri) {
  const verifier = randomBytes(32).toString("base64url");
  const challenge = createHash("sha256").update(verifier).digest("base64url");
  const url = new URL(authorizationEndpoint);
  url.search = new URLSearchParams({
    client_id: "dynamic_agent_client",
    agent_name_hint: "Browser Control OAuth Feasibility Probe",
    ext_agent_host_id: `urn:uuid:${randomUUID()}`,
    response_type: "code",
    redirect_uri: redirectUri,
    scope: "openid profile email offline_access resource.invoke chatgpt.tokens.use.direct",
    resource: "https://api.openai.com/v1",
    state: randomBytes(32).toString("base64url"),
    nonce: randomBytes(32).toString("base64url"),
    code_challenge_method: "S256",
    code_challenge: challenge,
  }).toString();
  return url;
}

for (const [name, redirectUri] of Object.entries(redirects)) {
  const response = await fetch(authorizationUrl(redirectUri), {
    redirect: "manual",
    signal: AbortSignal.timeout(15000),
  });
  const location = response.headers.get("location");
  const destination = location ? new URL(location, authorizationEndpoint) : null;
  console.log(JSON.stringify({
    name,
    redirectUri,
    status: response.status,
    destination: destination ? `${destination.origin}${destination.pathname}` : null,
    contentType: response.headers.get("content-type"),
  }));
}

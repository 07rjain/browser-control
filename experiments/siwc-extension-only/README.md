# Sign in with ChatGPT: extension-only feasibility probe

This folder is deliberately separate from Browser Control. It tests one narrow
question: does the open-source ChatGPT-plan authorization flow accept Chrome's
extension OAuth callback (`https://<id>.chromiumapp.org/...`) instead of the
documented loopback callback (`http://127.0.0.1/...`)?

It does not sign in, register an agent, exchange an authorization code, store
tokens, or call a model. Do not approve a consent screen during this probe.

Run the network probe with Node 20+:

```sh
node experiments/siwc-extension-only/probe.mjs
```

To generate a candidate authorization URL for a manual browser check without
making a network request:

```sh
node experiments/siwc-extension-only/probe.mjs --browser-url
```

The script sends two otherwise equivalent, unauthenticated authorization-page
requests. It follows no redirects, sends no browser cookies, and prints only
status codes plus the destination origin/path. The loopback request is a control;
the `chromiumapp.org` request is the candidate. A login redirect for both is
**inconclusive**, not proof that the candidate can complete OAuth. An explicit
redirect validation error would rule it out at this stage.

## Results on 2026-10-03

- Both unauthenticated requests returned HTTP `403` with `text/html` and no
  redirect. They were indistinguishable at this stage. This is **inconclusive**
  about callback acceptance; the script did not receive an OAuth error or code.
- Opening the candidate authorization URL in the connected Brave browser was
  blocked by Brave with `ERR_BLOCKED_BY_CLIENT` before any OpenAI page or
  consent screen loaded. The temporary tab was closed. No sign-in or consent
  occurred.
- No token endpoint, model endpoint, or product code was called or changed.

The candidate uses a syntactically valid placeholder extension ID, not a
registered OpenAI client or an installed extension. A later end-to-end test
would need a real extension ID and an approved callback path.

OpenAI's published flow requires an HTTP listener at `127.0.0.1` before opening
the browser. Chrome's `identity.launchWebAuthFlow` completes only at a
`chromiumapp.org` redirect. A browser-only implementation must have an
officially supported callback that bridges this difference; do not intercept
loopback redirects, scrape ChatGPT cookies, or exchange credentials through an
undocumented endpoint.

Sources:

- https://developers.openai.com/siwc/token-sharing-open-source/sign-in
- https://developer.chrome.com/docs/extensions/reference/api/identity

If the candidate is not rejected before login, the remaining validation needs
OpenAI to confirm support for the Chrome callback (or an authorized test account
to complete consent and code exchange). Do not treat this pre-login probe as an
end-to-end sign-in test.

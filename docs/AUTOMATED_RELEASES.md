# Automated GitHub and Chrome Web Store releases

Publishing a stable GitHub Release in `07rjain/browser-control` is the explicit
release action. Ordinary pushes and pull requests run compatibility CI only.
The release workflow checks the exact tagged commit on Linux, Windows, and macOS,
preserves its release assets, publishes the matching portable companion in
`07rjain/browser-control-support`, then uploads the extension using the official
Chrome Web Store **v2** API and requests normal review. Google approval is still
required. Approved submissions publish automatically.

## One-time setup

Project: `spatial-climate-511102-s3`. Use the Google account that owns the project;
the Store publisher account is `cu.16bcs2797@gmail.com`.

1. Review and run [setup-chrome-publishing.sh](../scripts/setup-chrome-publishing.sh)
   in [Google Cloud Shell](https://console.cloud.google.com/cloudshell/editor?project=spatial-climate-511102-s3):
   download the script from the reviewed commit, then run
   `bash setup-chrome-publishing.sh spatial-climate-511102-s3`.
   It enables the required APIs, creates `chrome-store-publisher`, and restricts
   GitHub federation to the numeric repository/owner IDs, this release workflow,
   the `chrome-web-store` environment, stable release tags, and manual runs on main.
   Both GitHub’s classic subject and its immutable subject (with numeric owner/repo
   IDs) are supported; numeric IDs are independently required in either case.
   It grants impersonation of this one service account, with no project resource
   roles and no JSON key. The operator needs project service-enablement, service
   account administration, and Workload Identity pool administration rights.
   If Google requires terms or billing, the project owner must decide and complete
   that separately. This script does not enroll in billing.
2. In Chrome Web Store Developer Dashboard → publisher Settings → Service account,
   add `chrome-store-publisher@spatial-climate-511102-s3.iam.gserviceaccount.com`.
   **Google grants the account access to every item owned by this publisher**;
   only one service account can be linked. The workflow client addresses only
   Browser Control (`mpdfhhhjgbpdpfnkjbnboebdjokfjglf`). Do not replace an existing
   linked account without reviewing its use.
3. Create the GitHub Actions environment `chrome-web-store` in
   `07rjain/browser-control`. Add these **environment variables**, using the script
   output (the provider path uses the numeric Google project number, not project ID):

   | Variable | Value |
   | --- | --- |
   | `CWS_WORKLOAD_IDENTITY_PROVIDER` | Script output: `projects/NUMBER/locations/global/workloadIdentityPools/github-browser-control/providers/github-releases` |
   | `CWS_SERVICE_ACCOUNT` | `chrome-store-publisher@spatial-climate-511102-s3.iam.gserviceaccount.com` |

4. Companion downloads live in a separate repository, so the source repository's
   `GITHUB_TOKEN` cannot publish them. Create a **fine-grained GitHub PAT**, limited
   to **only** `07rjain/browser-control-support`, with **Contents: Read and write**.
   Paste it directly into the `chrome-web-store` environment secret
   `COMPANION_RELEASE_TOKEN`. Choose an expiry and rotate before it expires.
   Never send the token in chat or put it in a file/commit. A GitHub App token is
   an alternative if you later want to manage an App instead of this scoped PAT.
5. Merge this workflow to main. Run **Publish browser release → Run workflow**
   from main, leave the tag empty and **dry_run = true**. This reads Store status only:
   no source release assets, companion release, upload, or submission is changed.
   Allow several minutes for Google IAM propagation after setup.
6. After the read-only check succeeds, set repository Actions variable
   `CWS_RELEASES_ENABLED=true`. Automatic publishing remains disabled until then.
   To pause future automatic releases, set it to `false`. Required environment
   reviewers are optional; enabling them intentionally adds a human pause.

The Google token is short-lived and scoped to `chromewebstore`. It is passed only
to the publishing step. Neither token nor service credentials enter the extension,
companion ZIP, repository, browser storage, or release artifacts. No Chrome
permissions, account behavior, memory behavior, or user data collection change.

## Each release

1. Update `package.json`, both package-lock root versions, `public/manifest.json`,
   and `companionVersion` in `scripts/install-native-host.mjs`. Update release
   notes and any Store privacy/listing disclosures as needed; merge to main.
2. Create tag `vX.Y.Z` at that main commit and **publish its stable GitHub Release**.
   Drafts/prereleases do not deploy. All 15 desktop compatibility jobs must pass
   again at the validated commit before publication.
3. Watch **Publish browser release** in Actions. The final summary reports whether
   it submitted, was already pending review, or was already published. The Store
   dashboard shows review decisions; GitHub success means submission, not approval.

## Failures and reruns

- Global concurrency serializes publishing without canceling an active run.
- Source release ZIPs/checksums are never overwritten. Reruns download the exact
  existing assets; partial source assets stop for manual inspection. Checksums and
  the ZIP manifest version are checked before publishing the companion or Store.
- Companion releases start as drafts. Existing matching assets are reused; a
  conflicting asset fails instead of being replaced. The companion must be public
  before the Store upload begins.
- A matching published or pending-review version is a successful no-op. Another
  submitted revision, a rejected/staged/canceled revision, policy warnings, an
  in-progress upload, or a downgrade stops for dashboard inspection. Automation
  never cancels a review, bypasses review, or ignores warnings.
- Upload processing is polled for up to five minutes; HTTP requests have two-minute
  timeouts and the publishing job has a 20-minute limit. An ambiguous failure after
  a publish request needs a status check before a rerun. Do not delete a live
  companion release to recover from a Store submission error.
- Store listing text, screenshots, privacy answers, distribution changes, and
  reviewer instructions remain dashboard work: these are not edited by this API.
  Update them before publishing a release that changes the disclosures.
- PAT expiry/permission errors affect companion publishing; Google 401/403 usually
  means federation settings, API enablement, or publisher service-account linking.
  Fix the configuration and rerun the failed workflow. Never print credentials in
  diagnostics.

## Validation

`npm test -- --run tests/chrome-store-publishing.test.ts` exercises the real API
client with intercepted HTTP responses, including read-only default, duplicate
submission, conflicting review, upload failures, async processing, and safe error
reporting. No Google account or live upload is used. Release helper commands run
on the Ubuntu publisher runner; the distributed extension/companion continue to
use the existing three-OS compatibility gates.

Official references: [service-account setup](https://developer.chrome.com/docs/webstore/service-accounts),
[Google GitHub authentication](https://github.com/google-github-actions/auth),
[GitHub OIDC claims](https://docs.github.com/en/actions/reference/security/oidc),
[Store API v2](https://developer.chrome.com/docs/webstore/using-api/).

#!/usr/bin/env bash
# Run in Google Cloud Shell, signed in as the owner of this dedicated project.
# No keys, hosted server, billing enrollment, or broad project roles are created.
set -euo pipefail
project="${1:-spatial-climate-511102-s3}"
if [[ ! "$project" =~ ^[a-z][a-z0-9-]{4,61}[a-z0-9]$ ]]; then
  echo 'Invalid project ID.' >&2
  exit 1
fi
command -v gcloud >/dev/null
number="$(gcloud projects describe "$project" --format='value(projectNumber)')"
sa="chrome-store-publisher@${project}.iam.gserviceaccount.com"
pool="github-browser-control"
provider="github-releases"

gcloud services enable chromewebstore.googleapis.com iam.googleapis.com iamcredentials.googleapis.com sts.googleapis.com --project="$project"
if ! gcloud iam service-accounts list --project="$project" --filter="email=$sa" --format='value(email)' | grep -qx "$sa"; then
  gcloud iam service-accounts create chrome-store-publisher --project="$project" --display-name='Browser Control Store publisher'
fi
if ! gcloud iam workload-identity-pools describe "$pool" --location=global --project="$project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools create "$pool" --location=global --project="$project" --display-name='Browser Control GitHub releases'
fi
condition="assertion.repository_id == '1341946319' && assertion.repository_owner_id == '37180068' && assertion.sub in ['repo:07rjain/browser-control:environment:chrome-web-store', 'repo:07rjain@37180068/browser-control@1341946319:environment:chrome-web-store'] && assertion.workflow_ref == '07rjain/browser-control/.github/workflows/release.yml@' + assertion.ref && ((assertion.event_name == 'release' && assertion.ref.startsWith('refs/tags/v')) || (assertion.event_name == 'workflow_dispatch' && assertion.ref == 'refs/heads/main'))"
args=(--location=global --workload-identity-pool="$pool" --project="$project" --issuer-uri='https://token.actions.githubusercontent.com' --attribute-mapping='google.subject=assertion.sub,attribute.repository_id=assertion.repository_id,attribute.repository_owner_id=assertion.repository_owner_id,attribute.workflow_ref=assertion.workflow_ref,attribute.event_name=assertion.event_name,attribute.ref=assertion.ref' --attribute-condition="$condition")
if gcloud iam workload-identity-pools providers describe "$provider" --workload-identity-pool="$pool" --location=global --project="$project" >/dev/null 2>&1; then
  gcloud iam workload-identity-pools providers update-oidc "$provider" "${args[@]}"
else
  gcloud iam workload-identity-pools providers create-oidc "$provider" "${args[@]}"
fi
gcloud iam service-accounts add-iam-policy-binding "$sa" --project="$project" --role='roles/iam.workloadIdentityUser' --member="principalSet://iam.googleapis.com/projects/${number}/locations/global/workloadIdentityPools/${pool}/attribute.repository_id/1341946319" >/dev/null
printf '\nSet these GitHub chrome-web-store environment variables:\nCWS_WORKLOAD_IDENTITY_PROVIDER=projects/%s/locations/global/workloadIdentityPools/%s/providers/%s\nCWS_SERVICE_ACCOUNT=%s\n\nLink this service-account email in the Chrome Web Store publisher Settings:\n%s\n' "$number" "$pool" "$provider" "$sa" "$sa"

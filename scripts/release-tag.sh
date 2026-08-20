#!/usr/bin/env bash
# Create (or retry) a signed release tag and watch it through the Release
# workflow. Safe to re-run: it refuses to touch a tag that already has a
# published GitHub release, and cleans up a previous failed attempt's tag
# before recreating it.
#
# Usage: scripts/release-tag.sh 0.2.0-beta.2
set -euo pipefail

version="${1:?Usage: scripts/release-tag.sh <version>, e.g. 0.2.0-beta.2}"
tag="v${version}"

if ! command -v gh >/dev/null; then
  echo "error: gh CLI is required." >&2
  exit 1
fi

echo "==> Checking for an existing GitHub release on ${tag}"
if gh release view "${tag}" >/dev/null 2>&1; then
  echo "error: ${tag} already has a published GitHub release. Refusing to touch it." >&2
  echo "Bump to the next version instead." >&2
  exit 1
fi

echo "==> Syncing main"
git checkout main -q
git pull -q

pkg_version=$(node -p 'require("./packages/core/package.json").version')
if [ "${pkg_version}" != "${version}" ]; then
  echo "error: packages/core/package.json is at ${pkg_version}, not ${version}." >&2
  echo "Land the release-prep PR (version bump, changelog) before tagging." >&2
  exit 1
fi

if [ -n "$(git status --short)" ]; then
  echo "error: working tree is not clean." >&2
  git status --short >&2
  exit 1
fi

echo "==> Cleaning up any previous attempt at ${tag}"
git push origin ":refs/tags/${tag}" >/dev/null 2>&1 || true
git tag -d "${tag}" >/dev/null 2>&1 || true

echo "==> Creating signed tag ${tag} on $(git rev-parse --short HEAD)"
if ! git tag -s "${tag}" -m "${tag}"; then
  cat >&2 <<'EOF'

Signing failed. This is a local gpg-agent/pinentry problem, not a script bug.
Quick checks:
  export GPG_TTY=$(tty)
  gpgconf --kill gpg-agent
  echo "test" | gpg --clearsign
If that also fails or cancels instantly, the configured pinentry-program in
~/.gnupg/gpg-agent.conf likely doesn't exist at the path it points to, or
gpg-agent can't reach it. Consider switching to SSH-based tag signing, which
sidesteps pinentry entirely — see docs/maintainers/releasing.md.

Once signing works, just re-run this script; it will clean up the failed
attempt and retry.
EOF
  exit 1
fi

echo "==> Verifying signature"
git tag -v "${tag}"

echo "==> Pushing ${tag}"
git push origin "${tag}"

echo "==> Waiting for the Release workflow to start"
run_id=""
for _ in $(seq 1 20); do
  run_id=$(gh run list --workflow release.yml --branch "${tag}" --limit 1 --json databaseId,createdAt \
    --jq 'sort_by(.createdAt) | reverse | .[0].databaseId // empty')
  [ -n "${run_id}" ] && break
  sleep 3
done

if [ -z "${run_id}" ]; then
  echo "error: no Release workflow run appeared for ${tag} after 60s. Check https://github.com/NorthShoreSoftwareLabs/demiurge/actions" >&2
  exit 1
fi

echo "==> Watching run ${run_id}"
echo "    https://github.com/NorthShoreSoftwareLabs/demiurge/actions/runs/${run_id}"
if gh run watch "${run_id}" --exit-status; then
  echo "==> Release workflow succeeded."
  gh release view "${tag}" || true
else
  echo "error: Release workflow failed. Fix the cause, then re-run this script — it will clean up ${tag} and retry." >&2
  exit 1
fi

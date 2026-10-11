# OSS Scanner build image (https://github.com/anthropics/oss-scanner).
# The scanner builds this with the repository as the build context, then runs
# its audit offline, so every dependency the tests need is fetched here.
# CI uses Deno v2.x; the image pins the current 2.9 release for repeatability.
FROM denoland/deno:debian-2.9.7

ENV DEBIAN_FRONTEND=noninteractive
# bash, git and shellcheck are spawned by some tests (bash/shellcheck gates,
# version-downgrade check).
RUN apt-get update && apt-get install -y --no-install-recommends \
      ca-certificates bash git shellcheck \
    && rm -rf /var/lib/apt/lists/*

# scanner contract: the checkout lives inside the image, at /src
COPY . /src
WORKDIR /src

# Fetch every jsr:/npm: module against the lockfile, then type-check the same
# paths as quality.sh (including tests and the PWA under docs/), so the offline
# audit can run the suite with a warm cache. The PWA itself has no build step:
# docs/ is served as-is (`./helpers/server.sh` serves it on port 8000).
RUN deno install --frozen --lock=deno.lock \
    && deno check helpers/ scripts/ tests/ docs/

# Smoke-run the snapshot loader, CSP and service-worker tests; a failure warns
# rather than aborting the build. The full suite is
# `deno test -A --reporter=dot` from /src.
RUN (deno test -A --reporter=dot \
      tests/snapshot_loader_test.ts tests/snapshot_loader_gunzip_test.ts \
      tests/snapshot_loader_fetch_test.ts tests/csp_meta_test.ts \
      tests/pwa_test.ts tests/sw_static_files_test.ts \
      || echo "WARNING: smoke tests reported failures")

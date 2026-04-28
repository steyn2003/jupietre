#!/bin/sh
# Entrypoint runs as root so it can fix ownership on volume mounts that
# carry over from previous container generations (or were initialized as
# root when Docker first attached the volume), then drops to the unprivileged
# `app` user before exec'ing the server.
#
# This is the recommended pattern for Docker images that combine named
# volumes with a non-root runtime user — without it, every `git fetch` /
# `git worktree add` against a previously-cloned repo fails with
# "Permission denied" on .git/FETCH_HEAD or refs/.../*.lock.

set -e

# Volume mount points we manage. Listed explicitly so we don't accidentally
# chown filesystem paths that should stay root-owned (the rest of /app comes
# from COPY --chown=app:app in the Dockerfile).
for d in /app/data /data/repos /home/app/.config/gh /home/app/.claude; do
  if [ -d "$d" ]; then
    chown -R app:app "$d" 2>/dev/null || true
  fi
done

# Drop privs and exec the app. tini wraps the whole thing for proper signal
# handling and zombie reaping.
exec /usr/bin/tini -- gosu app "$@"

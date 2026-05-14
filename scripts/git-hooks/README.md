# Git hooks

Repo-tracked git hooks. Activated via `core.hooksPath` (one-time per clone).

## One-time install

From the repo root:

```bash
git config core.hooksPath scripts/git-hooks
```

That's it. The next time you `git commit`, the `pre-commit` hook will run.

On Linux / macOS you also need:

```bash
chmod +x scripts/git-hooks/pre-commit
```

(Not needed on Windows — Git for Windows ignores the executable bit and runs scripts via its bundled bash.)

## What's in here

### `pre-commit`
Scans staged changes for secret-like patterns (API keys, tokens, JWTs, private key blocks). Blocks the commit if any match. See the file's header comment for the full list of patterns covered.

Bypass (only when you're certain it's a false positive):

```bash
git commit --no-verify
```

## Verify the hook is wired up

```bash
git config core.hooksPath
# should print: scripts/git-hooks
```

If it prints nothing, the install command didn't run.

## Adding new patterns

Edit `pre-commit`, append to the `PATTERNS` array. Test locally by staging a file containing a deliberate match and trying to commit — the hook should block it. Then `git commit --no-verify` your pattern change once you've verified it.

# Resolved: personal document purged from Git history

**Status: resolved on 2026-08-13 by a history rewrite and force push.**
One residual step is outside this repository's control — see the end.

## What was found

A CV PDF (146 KB, containing a real person's name) was committed in the very
first commit of this repository and later deleted from the tree. Deleting it was
not sufficient: the blob stayed fetchable at the original commit SHA, and the
repository is public.

| | |
|---|---|
| Path | `backend/data/uploads/CV_<name>.pdf` |
| Blob | `9c460d9` |
| Introduced in | `9be4d25` — *"Initial commit"* |
| Present anywhere today | **No** — purged from every commit, local and remote |

The contents were never opened or logged during the audit — only the path, size
and commit metadata.

## What was done

A single `git filter-repo` pass, prepared and verified on a throwaway clone
before anything was published, removed two things at once:

1. The CV blob from every commit.
2. Seven stray `Co-Authored-By` trailers, which GitHub was rendering as a
   second contributor on those commits.

Nothing else was touched. The verification that matters is that the resulting
tree came out **byte-identical** to the one before the rewrite —
`661951ddbcd12b040dbc7aa5bf5b5ce53cf92be3` on both sides — so no source file,
author, email, date or commit subject changed. All ten commits survived; only
their SHAs moved, which is unavoidable when history is rewritten.

`main` went from `b0f205e` to `2875560` via
`git push --force-with-lease`, with the lease pinned to the expected old tip so
the push would abort rather than clobber any concurrent work.

Confirmed afterwards from a fresh independent clone of the remote: no CV path,
no `backend/data/uploads/`, no PDF of any kind, blob `9c460d9` absent from the
object store, zero `Co-Authored-By` trailers, and a single author and committer
across all ten commits.

## The part that is not fixed by a force push

**Anyone who cloned or forked before 2026-08-13 still has the blob.** Nothing
done to this repository reaches their copy.

**GitHub still serves the old objects by SHA — confirmed, not hypothetical.**
Checked immediately after the force push on 2026-08-13: the old commit
`9be4d25` still returns HTTP 200, its tree still lists the CV path, and blob
`9c460d9` (149,259 bytes) is still served directly. Rewriting history leaves
the previous objects unreferenced rather than deleted, and GitHub keeps them
reachable.

**So the document is still publicly fetchable at the time of writing**, despite
the repository's own history being clean. The git-side work is necessary but
does not by itself end the exposure.

Two ways to finish it:

- **Ask GitHub Support to purge the unreachable objects** — the option that
  keeps this repository URL, which is why the rewrite took this route.
- **Delete and recreate the repository** — immediate and self-service, but it
  changes nothing about forks and it discards the repository's stars, issues
  and URL. Deliberately not done here.

Until one of those happens, treat the CV as still exposed.

## Also worth doing

- **Tell the person whose CV it is.** It is their document, it was public for a
  period, and they should know regardless of the cleanup.
- `.gitignore` excludes `backend/data/uploads/`, so this cannot recur.
- No other personal documents or secrets exist in history. The full-history
  audit found no `.env`, `.pem`, `.key`, `id_rsa`, or key-shaped strings in any
  revision, and no PDF other than the one removed.

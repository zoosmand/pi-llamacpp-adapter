# Repository workflow

- Create an issue and initial comment before task implementation; branch `issue-<number>` from `dev`.
- Never commit or push without explicit user approval. Leave changes available for review.
- Never push directly to `dev` or `master`; issue branches target `dev`.
- Combine separately developed issues using `bunch-<issue_number>_*..._*<issue_number>` (for example `bunch-1_2_3`); resolve integration conflicts there.
- Preserve existing uncommitted work; use a separate worktree when necessary.
- Do not use Postman skills unless the user explicitly re-enables them.

# Repository workflow

- Before investigating or implementing a task, create a GitHub issue and add an initial comment describing the work.
- Then create `issue-<issue_number>` from `dev` and work on that branch.
- Never push directly to `dev` or `master`. Push task changes to issue branches; their merge target is `dev`.
- When combining tasks developed on separate branches, use an accumulation branch named `bunch-<issue_number>_*..._*<issue_number>` (for example, `bunch-1_2_3`). Resolve integration conflicts there before merging into `dev`.
- Do not use Postman skills for current adapter work unless the user explicitly asks to re-enable them.

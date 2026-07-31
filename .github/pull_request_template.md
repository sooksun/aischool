# <!-- SEIP-XXX-000 --> Task ID

## What changed

<!-- One paragraph. What a reviewer needs before reading the diff. -->

## Operating-system checks

- [ ] Branch is `ai/<agent>/<task-id>-<name>` (charter rule 3 — no direct work on `main` or `develop`)
- [ ] Every changed path is inside the task's `allowed_paths` in `.ai-team/task-board.yaml`
- [ ] No changed path is inside another agent's module in `.ai-team/module-ownership.yaml`
- [ ] Paths are locked to this task ID in `.ai-team/file-locks.yaml`
- [ ] Handoff written to `.ai-team/handoffs/<task-id>.md` (charter rule 7)

## Acceptance criteria

<!-- Copy from the work order and tick what this PR actually satisfies.
     Anything left unticked must be explained under "Not done". -->

## Verification

<!-- Paste the commands you ran and their real output. Charter rule: never
     claim completion without showing verification results. -->

```
```

## Not done

<!-- Anything in scope that this PR does not deliver, and why. Write "nothing"
     if the work order is fully satisfied. -->

## Contract impact

- [ ] No contract in `docs/contracts/**` is changed by this PR
- [ ] Or: a Contract Change Request is filed (`.ai-team/templates/contract-change-request.md`)

## Reviewer

<!-- The reviewer named in module-ownership.yaml for the module you touched.
     module-ownership.yaml wins over the board if they disagree (ADR-0002 §6). -->

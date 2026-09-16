# CLAUDE.md: crypto-deposit

## Code Quality Review: Thermo-Nuclear Standard (MANDATORY)

> Whenever you write or update code, load the
> **`thermo-nuclear-code-quality-review`** skill
> (`~/.claude/skills/thermo-nuclear-code-quality-review`, also installed in this repo at `.claude/skills/thermo-nuclear-code-quality-review`) and hold your
> own diff to it before you call the work done, commit, or ask to push. There is
> no "too small" exemption.

Code means anything that executes: source, tests, scripts, migrations, database
rules, build and CI config. Prose-only edits do not trigger it.

### Procedure

1. **Load it before the first code edit of the session** with the Skill tool. It
   stays loaded for the session; apply it to every later change.
2. **Design against it before writing.** Look for the code-judo move first: a
   framing in which branches, flags or layers disappear instead of being added.
   Put new logic in the layer that owns the concept, and reuse the canonical
   helper rather than writing a near-duplicate.
3. **Review your own diff after writing**, before you report done, commit, or ask
   to push. Review only what you authored (`git diff -- <your files>`). Another
   session's uncommitted work in the same tree is not yours to restructure.
4. **Fix what you find inside the change.** Structural findings in code you wrote
   or touched are fixed, not noted. A restructure that reaches beyond the
   requested change is reported as a recommendation naming the concrete move. It
   is never done silently.
5. **Report it.** End the response with a short **Code quality review** block:
   files touched with their line counts, findings most severe first, what was
   fixed, and what was deferred and why. Write "no findings" only when the
   skill's approval bar is genuinely met.

### The 1,000-line rule

- A change never pushes a file from under 1,000 lines to over 1,000.
- A file already past 1,000 lines gets no new feature logic inline. Put it in a
  focused module and call it.

### Safety outranks elegance

Where a project has its own money, security, data-integrity or release rules,
they win.

- Never bundle a restructure with a security or money fix. Patch the invariant
  first, then propose the restructure as its own change.
- Never delete a guard, validation, idempotency check or fail-closed branch
  because it looks like special-casing. Those branches are the invariants.
- A clean review never replaces the project's tests, lint or release gates.

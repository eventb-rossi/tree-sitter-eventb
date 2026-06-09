# GitHub Linguist submission — PREPARED, DO NOT SUBMIT YET

> ⚠️ **HOLD.** GitHub Linguist only adds an extension once it has **substantial,
> distributed usage** (roughly **200+ files for once-per-repo extensions** or
> **2,000+ files for multi-file extensions**, across many unique repos, in the
> last year, excluding forks) and explicitly **"will not accept PRs for very new
> or hobby languages."** The textual `.eventb` format is new and almost certainly
> below that bar today. Everything below is ready to go; **open the PR only once
> the usage gate (bottom of this file) is met.**

## What Linguist actually consumes

Linguist does two things: **detect** a file's language (from `languages.yml` +
samples + heuristics) and pick a **grammar** for highlighting (`vendor/grammars`,
listed in `grammars.yml`). Both TextMate grammars **and** tree-sitter grammars
are vendored.

- The **documented, self-serve** path for a *new* language (in Linguist's
  `CONTRIBUTING.md`) uses a **TextMate** grammar referenced by `tm_scope`:
  `script/add-grammar <repo>` + a `tm_scope` in `languages.yml`.
- **tree-sitter** highlighting for a language is a **curated / maintainer-driven**
  path; you cannot rely on a self-serve PR to wire a brand-new language to
  tree-sitter highlighting.

So the pragmatic submission is: register the language with `tm_scope:
source.eventb`, and vendor a TextMate grammar for the highlighting fallback.
Rossi **already generates** one —
`editors/vscode/syntaxes/eventb.tmLanguage.json` (scope `source.eventb`) — which
can be published/vendored for `tm_scope`, while *this* tree-sitter grammar is the
forward path for tree-sitter highlighting when that route opens.

## `languages.yml` entry (draft)

Add under the alphabetical position for `Event-B` (omit `language_id` — it is
assigned by `script/update-ids`):

```yaml
Event-B:
  type: programming
  color: "#1e4b7a"        # suggestion; pick a final color before submitting
  extensions:
  - ".eventb"
  tm_scope: source.eventb
  ace_mode: text
```

## Grammar

Self-serve / TextMate highlighting:

```sh
# In a fork of github-linguist/linguist, vendoring the TextMate grammar that
# backs tm_scope: source.eventb (Rossi generates this file):
script/add-grammar https://github.com/eventb-rossi/eventb-tmbundle   # or wherever it is published
```

tree-sitter (curated path): point maintainers at
`https://github.com/eventb-rossi/tree-sitter-eventb` (this repo).

> The grammar repo must carry an OSI license on Linguist's allowed list. This
> repo is dual MIT / Apache-2.0 — both are allowed.

## Samples

Linguist needs at least one real-world sample (two if the extension collides with
another language — `.eventb` does not). Copy a couple of the `.eventb` files from
`examples/` into `samples/Event-B/` in the Linguist PR.

- Licensing: Rossi's examples are Apache-2.0. State this in the PR.
  `crates/rossi/examples/base-model.eventb` must keep its **ISP RAS / Ilya
  Shchepetkov** attribution if used.

## Heuristics

- `.eventb` is unique to this format — **no heuristic needed**.
- ⚠️ Do **not** map `.bum` / `.buc` here: those are **Rodin XML archives**
  (machine/context), not this textual syntax. They classify as XML. Mention this
  in the PR so reviewers don't conflate the formats.

## PR checklist (Linguist requires the template)

- [ ] Used Linguist's pull-request template (PRs without it are not reviewed).
- [ ] Linked GitHub code-search results proving in-the-wild usage:
      `https://github.com/search?q=path%3A*.eventb+MACHINE+OR+CONTEXT&type=code`
      (and/or `extension:eventb`) — must clear the usage gate below.
- [ ] Stated the sample license(s).
- [ ] Ran `script/update-ids` to assign `language_id`.

## Usage gate — the only thing blocking submission

Before opening the PR, confirm `.eventb` meets Linguist's bar:

- [ ] ≥ ~200 `.eventb` files (multi-file-per-repo: ≥ ~2,000) indexed in the last
      year, **excluding forks**.
- [ ] Spread across many distinct users/repos (not one project).

Until both hold, keep this submission on hold.

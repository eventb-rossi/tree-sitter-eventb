# tree-sitter-eventb

A [tree-sitter](https://tree-sitter.github.io/tree-sitter/) grammar for the
[Event-B](https://www.event-b.org/) formal-method language, as written in the
textual `.eventb` syntax used by [Rossi](https://github.com/eventb-rossi/rossi).

It powers syntax highlighting in editors that consume tree-sitter grammars — the
Rossi [Zed](https://github.com/eventb-rossi/rossi/tree/main/editors/zed)
extension, [nvim-treesitter](https://github.com/nvim-treesitter/nvim-treesitter),
[Helix](https://helix-editor.com/), and others — and is the grammar
prepared for [GitHub Linguist](https://github.com/github-linguist/linguist)
(see [docs/LINGUIST.md](docs/LINGUIST.md)).

## A lexical grammar (for now)

This is a *lexical* grammar: it recognises each coloured token class (keywords,
operators, constants, built-ins, comments, strings, numbers, labels,
identifiers) as its own node so `queries/highlights.scm` can paint it. It does
**not** yet parse Event-B structure — in Rossi, the `eventb-language-server`
provides diagnostics, completion, outline and folding over LSP. The grammar is
intended to be **hand-extended** with structural rules over time; the generated
token core stays verified throughout (see below).

The highlight captures use the standard ecosystem names (`@keyword`,
`@operator`, `@constant.builtin`, `@function.builtin`, `@comment`, `@string`,
`@number`, `@label`, `@variable`, `@punctuation.*`).

## Generated from Rossi — do not hand-edit the generated parts

The token-level core is generated from Rossi's canonical token tables
(`crates/rossi/src/{keywords,operators,builtins}.rs`) by `cargo xtask gen-grammars`, so
it can never drift from the parser:

| File | What is generated |
| --- | --- |
| `grammar.js` | the token rules, between the `// >>> cargo xtask gen-grammars` markers |
| `queries/highlights.scm` | the token→capture lines, between the `; >>> cargo xtask gen-grammars` markers |
| `test/tokens.json` | the canonical token manifest (`{ node: [spellings] }`) |

Everything **outside** those markers — the grammar scaffold and any future
hand-written structural rules and captures — is hand-maintained and preserved by
the generator. To change the token set, edit the tables in Rossi and run
`cargo xtask gen-grammars`; Rossi's CI runs `gen-grammars --check`
to guarantee this repo's generated regions and `tokens.json` stay byte-identical
to the tables.

## Verifying the core after hand-extension

`test/tokens.test.js` reads the generated `test/tokens.json` and, for every
canonical spelling, parses it with the **built** grammar and asserts it
tokenizes to the matching node. Because it checks the parser's observable
behavior (not the grammar's source text), it keeps proving that the generated
core matches `gen-grammars` even as structural rules are added by hand.

## Development

Use **Node 22 LTS**: the `tree-sitter` dev dependency (node-tree-sitter,
latest 0.25.0) compiles its native binding with `-std=c++17` and ships no
prebuilds, while Node 23+'s V8 headers require C++20 — `npm ci` fails to
build it on Node 24.

```sh
npm ci                       # install tree-sitter-cli (0.26.9) + build the node binding
npx tree-sitter generate     # regenerate src/parser.c from grammar.js
git diff --exit-code src/    # the committed parser must match grammar.js
npx tree-sitter test         # parse-tree corpus (test/corpus/*.txt)
npm test                     # behavioral contract + binding smoke test (node --test)
```

## Using the grammar

- **nvim-treesitter** — register a custom parser pointing at this repo, then
  `:TSInstall eventb`. Files with the `eventb` extension use `source.eventb`.
- **Helix** — add a `[[language]]` for `eventb` with a `[[grammar]]` `source.git`
  pointing here, then `hx --grammar fetch && hx --grammar build`.
- **Zed** — handled by the Rossi Zed extension, which pins this repo in its
  `extension.toml`.

## License

Dual-licensed under either of [Apache-2.0](LICENSE-APACHE) or [MIT](LICENSE-MIT)
at your option, matching Rossi.

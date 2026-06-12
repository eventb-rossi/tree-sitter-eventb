// Tree-sitter grammar for Event-B (Rossi), consumed by the Zed extension,
// nvim-treesitter, Helix, and other tree-sitter integrations.
//
// This is a *lexical* grammar: it recognises each coloured token class as its
// own node so `queries/highlights.scm` can paint it. It deliberately does not
// parse Event-B structure — the Rossi language server (`rossi-language-server`)
// provides diagnostics, completion, outline, folding and the rest over LSP
// (Zed, for one, can overlay the server's semantic tokens via
// `"semantic_tokens": "combined"`).
//
// The token rules between the `rossi gen-grammars` markers are GENERATED from
// the canonical token tables (crates/rossi/src/{keywords,operators,builtins}.rs).
// After changing those tables run `cargo run -p rossi-cli -- gen-grammars`, then
// `tree-sitter generate` to refresh src/parser.c. Everything else here is
// hand-maintained.
//
// No token carries precedence: tree-sitter's lexer resolves ties by precedence
// before length, so a precedence bump would let `mod` win over the longer
// `model` and `/` win over the `//` comment. Plain longest-match keeps
// identifiers and comments whole; the `word` directive below resolves the only
// exact-length tie (a whole word that equals a keyword).

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

export default grammar({
  name: 'eventb',

  // Whitespace separates tokens; comments are nodes (so they highlight) but are
  // skippable anywhere, so they live in `extras` rather than the token stream.
  extras: $ => [/\s/, $.comment],

  // Enable keyword extraction: a whole-word match of a `*_word` token resolves
  // to that token rather than to `identifier`, while `extends_foo` stays an
  // identifier. This is what lets the generated word tokens carry no precedence
  // yet still win the exact-length tie against `identifier`.
  word: $ => $.identifier,

  rules: {
    source_file: $ => repeat($._token),

    // A document is a flat stream of coloured tokens. We do not impose Event-B
    // structure here; the language server understands the model. The token
    // rules referenced here are generated below (`rossi gen-grammars`), split
    // into word/symbol nodes per coloured class.
    _token: $ => choice(
      $.keyword,
      $.status_keyword,
      $.constant_word,
      $.constant_sym,
      $.builtin,
      $.quantifier_word,
      $.operator_word,
      $.operator_sym,
      $.label,
      $.number,
      $.string,
      $.identifier,
      $._punctuation,
    ),

    // >>> rossi gen-grammars (generated, do not edit)
    keyword: $ => token(/(?:initialisation|invariants|constants|variables|theorems|context|extends|machine|refines|variant|witness|axioms|events|status|begin|event|where|sees|sets|then|when|with|any|end)/i),
    status_keyword: $ => token(/(?:anticipated|convergent|ordinary|theorem|skip)/i),
    constant_sym: $ => token(choice("ℕ1", "ℕ", "ℤ", "∅", "{}")),
    constant_word: $ => token(/(?:false|bool|nat1|true|int|nat)/i),
    builtin: $ => token(/(?:partition|finite|card|pred|prj1|prj2|succ|max|min|id)/),
    operator_sym: $ => token(choice("<<->>", "/<<:", ":∈", ":∣", "<->>", "<<->", ">->>", "ℙ1", "+->", "+>>", "-->", "->>", "/<:", "<->", "<<:", "<<|", "<=>", ">+>", ">->", "|->", "|>>", "‥", "ℙ", "→", "↔", "↠", "↣", "↦", "⇒", "⇔", "⇸", "∀", "∃", "∈", "∉", "−", "∖", "∗", "∘", "∣", "∥", "∧", "∨", "∩", "∪", "∼", "≔", "≠", "≤", "≥", "⊂", "⊄", "⊆", "⊈", "⊗", "⋂", "⋃", "▷", "◁", "⤀", "⤔", "⤖", "⦂", "⩤", "⩥", "", "", "", "", "**", "..", "/:", "/=", "/\\", "::", ":=", ":|", "<+", "<:", "<=", "<|", "=>", "><", ">=", "\\/", "|>", "||", "¬", "·", "×", "÷", "λ", "!", "#", "%", "&", "*", "+", "-", ".", "/", ":", ";", "<", "=", ">", "\\", "^", "|", "~")),
    quantifier_word: $ => token(/(?:inter|union)/i),
    operator_word: $ => token(/(?:oftype|POW1|circ|POW|dom|mod|not|ran|or)/),
    // <<< rossi gen-grammars

    // Hand-maintained structural tokens.
    identifier: $ => /[a-zA-Z_][a-zA-Z0-9_']*/,
    number: $ => /[0-9]+/,
    label: $ => /@[A-Za-z0-9_]+/,
    string: $ => token(seq('"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    comment: $ => token(choice(
      seq('//', /[^\n]*/),
      seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
    )),
    _punctuation: $ => choice('(', ')', '[', ']', '{', '}', ','),
  }
});

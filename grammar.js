// Tree-sitter grammar for Event-B (Rossi), consumed by the Zed extension,
// nvim-treesitter, Helix, and other tree-sitter integrations.
//
// This is a *structural* grammar for the textual `.eventb` syntax: it parses
// components (contexts and machines), their clauses, events, predicates and
// expressions, following the reference implementation in
// `crates/rossi/src/grammar.pest` and *The Event-B Mathematical Language*
// (Métayer & Voisin, 2009) — see EVENTB_LANGUAGE_REFERENCE.md in the rossi
// monorepo for the consolidated language reference.
//
// Design notes:
// - Keywords are case-insensitive (like rossi and Camille). Each keyword is a
//   regex token aliased to its canonical lowercase spelling, so queries match
//   plain strings ("machine", "sees", …). No keyword token carries lexical
//   precedence: tree-sitter resolves lexing ties by precedence before length,
//   and a precedence bump would let a keyword eat the prefix of a longer
//   identifier. Plain longest-match keeps identifiers whole; the `word`
//   directive below resolves exact-length ties (a whole word equal to a
//   keyword) in the keyword's favour — which is also what terminates
//   space-separated identifier lists at the next clause keyword.
// - Identifier lists accept optional commas, like rossi (spec says
//   space-separated; Rodin's text tools also emit commas).

/// <reference types="tree-sitter-cli/dsl" />
// @ts-check

/** Case-insensitive regex for a keyword, e.g. ci('end') => /[eE][nN][dD]/ */
function ci(word) {
  return new RegExp(
    word
      .split('')
      .map((c) => (/[a-z]/.test(c) ? `[${c}${c.toUpperCase()}]` : c))
      .join(''),
  );
}

/** A case-insensitive keyword displayed as its canonical lowercase spelling. */
function kw(word) {
  return alias(token(ci(word)), word);
}

/** One or more `rule`s separated by optional commas (identifier lists). */
function spaceSep1(rule) {
  return seq(rule, repeat(seq(optional(','), rule)));
}

/** One or more `rule`s separated by mandatory commas. */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

export default grammar({
  name: 'eventb',

  // Whitespace separates tokens; comments are nodes (so they highlight) but
  // are skippable anywhere.
  extras: ($) => [/\s/, $.comment],

  // Keyword extraction: a whole-word token that exactly matches a keyword
  // resolves to the keyword where the keyword is valid, and to `identifier`
  // elsewhere. This is what makes keywords reserved words.
  word: ($) => $.identifier,

  rules: {
    source_file: ($) => repeat(choice($.context, $.machine)),

    // ==========================
    // Context
    // ==========================

    context: ($) =>
      seq(
        kw('context'),
        field('name', $.identifier),
        repeat($._context_clause),
        kw('end'),
      ),

    _context_clause: ($) =>
      choice($.extends_clause, $.sets_clause, $.constants_clause),

    extends_clause: ($) => seq(kw('extends'), spaceSep1($.identifier)),

    sets_clause: ($) => seq(kw('sets'), spaceSep1($.set_declaration)),

    // Deferred set (S) or enumerated set (S = {a, b, c}).
    set_declaration: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq('=', '{', commaSep1($.identifier), '}')),
      ),

    constants_clause: ($) => seq(kw('constants'), spaceSep1($.identifier)),

    // ==========================
    // Machine
    // ==========================

    machine: ($) =>
      seq(
        kw('machine'),
        field('name', $.identifier),
        repeat($._machine_clause),
        kw('end'),
      ),

    _machine_clause: ($) =>
      choice($.refines_clause, $.sees_clause, $.variables_clause),

    refines_clause: ($) => seq(kw('refines'), field('target', $.identifier)),

    sees_clause: ($) => seq(kw('sees'), spaceSep1($.identifier)),

    variables_clause: ($) => seq(kw('variables'), spaceSep1($.identifier)),

    // ==========================
    // Lexical tokens
    // ==========================

    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_']*/,
    number: ($) => /[0-9]+/,
    // Per the TextEditor EBNF: all characters following `@` belong to the
    // label until the next whitespace character.
    label: ($) => /@[^\s]+/,
    string: ($) => token(seq('"', repeat(choice(/[^"\\]/, /\\./)), '"')),
    comment: ($) =>
      token(
        choice(
          seq('//', /[^\n]*/),
          seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
        ),
      ),
  },
});

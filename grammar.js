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

// Predicate precedence, lowest → highest (kernel_lang §3.2.4). Quantifier
// scope extends as far right as possible; ⇔ binds loosest, ¬ tightest.
// The spec forbids mixing ∧/∨ and chaining ⇒/⇔ without parentheses; like
// rossi's parser, we parse such chains permissively (left-associated) and
// leave rejection to semantic tooling.
const PRED = {
  quantified: 1,
  equivalence: 2,
  implication: 3,
  disjunction: 4,
  conjunction: 5,
  negation: 6,
};

export default grammar({
  name: 'eventb',

  // Whitespace separates tokens; comments are nodes (so they highlight) but
  // are skippable anywhere.
  extras: ($) => [/\s/, $.comment],

  // Keyword extraction: a whole-word token that exactly matches a keyword
  // resolves to the keyword where the keyword is valid, and to `identifier`
  // elsewhere. This is what makes keywords reserved words.
  word: ($) => $.identifier,

  conflicts: ($) => [
    // Predicates and expressions share atoms (true/false, parentheses): in
    // `(true)` the parser cannot know locally whether it is closing a
    // parenthesized predicate or a parenthesized expression that a relational
    // operator will follow. GLR keeps both readings until one completes.
    [$._predicate, $._expression],
  ],

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
      choice(
        $.extends_clause,
        $.sets_clause,
        $.constants_clause,
        $.axioms_clause,
        $.theorems_clause,
      ),

    extends_clause: ($) => seq(kw('extends'), spaceSep1($.identifier)),

    sets_clause: ($) => seq(kw('sets'), spaceSep1($.set_declaration)),

    // Deferred set (S) or enumerated set (S = {a, b, c}).
    set_declaration: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq('=', '{', commaSep1($.identifier), '}')),
      ),

    constants_clause: ($) => seq(kw('constants'), spaceSep1($.identifier)),

    axioms_clause: ($) =>
      seq(kw('axioms'), repeat1(alias($.labeled_predicate, $.axiom))),

    // A THEOREMS section holds theorem-flagged axioms (in a context) or
    // invariants (in a machine); Rodin models the flag as an attribute, not a
    // separate container.
    theorems_clause: ($) =>
      seq(kw('theorems'), repeat1(alias($.labeled_predicate, $.theorem))),

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
      choice(
        $.refines_clause,
        $.sees_clause,
        $.variables_clause,
        $.invariants_clause,
        $.theorems_clause,
      ),

    refines_clause: ($) => seq(kw('refines'), field('target', $.identifier)),

    sees_clause: ($) => seq(kw('sees'), spaceSep1($.identifier)),

    variables_clause: ($) => seq(kw('variables'), spaceSep1($.identifier)),

    invariants_clause: ($) =>
      seq(kw('invariants'), repeat1(alias($.labeled_predicate, $.invariant))),

    // ==========================
    // Labeled predicates
    // ==========================

    // Accepts "@label P", "theorem @label P", "@label theorem P", and bare
    // "P" (rossi-compatible; Rodin's text tools always emit labels).
    labeled_predicate: ($) =>
      seq(
        optional(
          choice(
            seq(kw('theorem'), field('label', $.label)),
            seq(field('label', $.label), optional(kw('theorem'))),
          ),
        ),
        field('predicate', $._predicate),
      ),

    // ==========================
    // Predicates
    // ==========================

    _predicate: ($) =>
      choice(
        $.quantified_predicate,
        $.binary_predicate,
        $.not_predicate,
        $.comparison_predicate,
        $.parenthesized_predicate,
        $.true,
        $.false,
        // Predicate application: finite(S), partition(S, A, B), and (like
        // rossi) any identifier applied to arguments.
        $.function_application,
      ),

    quantified_predicate: ($) =>
      prec.right(
        PRED.quantified,
        seq(
          field('quantifier', choice('∀', alias('!', '∀'), '∃', alias('#', '∃'))),
          commaSep1(field('binder', $.typed_identifier)),
          choice('·', alias('.', '·')),
          field('body', $._predicate),
        ),
      ),

    binary_predicate: ($) => {
      const table = [
        [PRED.equivalence, choice('⇔', alias('<=>', '⇔'))],
        [PRED.implication, choice('⇒', alias('=>', '⇒'))],
        [PRED.disjunction, choice('∨', alias(ci('or'), '∨'))],
        [PRED.conjunction, choice('∧', alias('&', '∧'))],
      ];
      return choice(
        ...table.map(([level, operator]) =>
          prec.left(
            level,
            seq(
              field('left', $._predicate),
              field('operator', operator),
              field('right', $._predicate),
            ),
          ),
        ),
      );
    },

    not_predicate: ($) =>
      prec(
        PRED.negation,
        seq(
          field('operator', choice('¬', alias(ci('not'), '¬'))),
          field('operand', $._predicate),
        ),
      ),

    // Operands are expressions, never comparisons, so relational operators
    // are non-associative by construction (x = y = z is ill-formed).
    comparison_predicate: ($) =>
      seq(
        field('left', $._expression),
        field('operator', choice(
          '=',
          choice('≠', alias('/=', '≠')),
          choice('≤', alias('<=', '≤')),
          choice('≥', alias('>=', '≥')),
          '<',
          '>',
          choice('∈', alias(':', '∈')),
          choice('∉', alias('/:', '∉')),
          choice('⊂', alias('<<:', '⊂')),
          choice('⊄', alias('/<<:', '⊄')),
          choice('⊆', alias('<:', '⊆')),
          choice('⊈', alias('/<:', '⊈')),
        )),
        field('right', $._expression),
      ),

    parenthesized_predicate: ($) => seq('(', $._predicate, ')'),

    // Bound variable with optional type annotation: x⦂T (Rodin's bcc output
    // spells types this way after type-checking).
    typed_identifier: ($) =>
      seq(
        field('name', $.identifier),
        optional(
          seq(
            choice('⦂', alias(ci('oftype'), '⦂')),
            field('type', $._expression),
          ),
        ),
      ),

    // ==========================
    // Expressions
    // ==========================

    _expression: ($) =>
      choice(
        $.identifier,
        $.number,
        $.string,
        $.true,
        $.false,
        $.integer_set,
        $.natural_set,
        $.natural1_set,
        $.bool_set,
        $.empty_set,
        $.builtin,
        $.function_application,
        $.parenthesized_expression,
      ),

    // The function position is an atom or another postfix expression, not an
    // arbitrary expression: f(x), prj1(s)(t), (E)(x).
    function_application: ($) =>
      prec.left(
        10,
        seq(
          field(
            'function',
            choice(
              $.identifier,
              $.builtin,
              $.function_application,
              $.parenthesized_expression,
            ),
          ),
          '(',
          commaSep1(field('argument', $._expression)),
          ')',
        ),
      ),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    // ==========================
    // Atomic constants and builtins
    // ==========================

    true: ($) => token(choice(ci('true'), '⊤')),
    false: ($) => token(choice(ci('false'), '⊥')),
    integer_set: ($) => token(choice('ℤ', ci('int'))),
    natural_set: ($) => token(choice('ℕ', ci('nat'))),
    natural1_set: ($) => token(choice('ℕ1', ci('nat1'))),
    bool_set: ($) => token(ci('bool')),
    empty_set: ($) => token(choice('∅', '{}', ',,')),
    builtin: ($) =>
      token(
        choice(
          ci('card'),
          ci('finite'),
          ci('id'),
          ci('max'),
          ci('min'),
          ci('partition'),
          ci('pred'),
          ci('prj1'),
          ci('prj2'),
          ci('succ'),
        ),
      ),

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

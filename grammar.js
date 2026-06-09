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

// Expression precedence, lowest → highest (kernel_lang §3.3.4, Table 3.1).
// Like rossi, levels the spec declares non-associative (relation arrows,
// interval, exponent) parse left-associated chains permissively; the set
// operator compatibility matrix (Table 3.2) is likewise a semantic check,
// not a parse-time one. Unary minus binds tighter than `^`, matching rossi's
// grammar.pest (`-a^b` is `(-a)^b`) rather than the spec's arithmetic level.
const EXPR = {
  quantified: 1,
  maplet: 2,
  arrow: 3,
  setop: 4,
  interval: 5,
  additive: 6,
  multiplicative: 7,
  exponent: 8,
  unary: 9,
  postfix: 10,
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
    // In `{x, …` an identifier is either a comprehension binder or the first
    // element of a set enumeration (or the expression form's element).
    [$.typed_identifier, $._expression],
    // `bool` followed by `(` is a predicate-to-BOOL conversion, but `bool`
    // is also the BOOL type literal.
    [$.bool_conversion, $.bool_set],
    // An action's identifier list is shared by all three assignment forms
    // until the operator (≔, :∈, :∣) decides among them.
    [$.assignment, $.becomes_member, $.becomes_such],
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
        $.variant_clause,
        $.events_clause,
      ),

    refines_clause: ($) => seq(kw('refines'), field('target', $.identifier)),

    sees_clause: ($) => seq(kw('sees'), spaceSep1($.identifier)),

    variables_clause: ($) => seq(kw('variables'), spaceSep1($.identifier)),

    invariants_clause: ($) =>
      seq(kw('invariants'), repeat1(alias($.labeled_predicate, $.invariant))),

    variant_clause: ($) =>
      seq(kw('variant'), field('expression', $._expression)),

    // ==========================
    // Events
    // ==========================

    events_clause: ($) => seq(kw('events'), repeat1($.event)),

    // The INITIALISATION event needs no special rule: its name parses as a
    // plain identifier (there is no `initialisation` keyword token to shadow
    // it).
    event: ($) =>
      seq(
        optional(field('convergence', $._convergence)),
        kw('event'),
        field('name', $.identifier),
        optional(
          choice(
            seq(kw('refines'), field('refines', $.identifier)),
            seq(kw('extends'), field('extends', $.identifier)),
          ),
        ),
        repeat($._event_clause),
        kw('end'),
      ),

    _convergence: ($) =>
      choice(kw('ordinary'), kw('convergent'), kw('anticipated')),

    _event_clause: ($) =>
      choice(
        $.status_clause,
        $.any_clause,
        $.where_clause,
        $.with_clause,
        $.witness_clause,
        $.then_clause,
      ),

    status_clause: ($) =>
      seq(kw('status'), field('convergence', $._convergence)),

    any_clause: ($) =>
      seq(kw('any'), spaceSep1(field('parameter', $.identifier))),

    where_clause: ($) =>
      seq(
        choice(kw('where'), kw('when')),
        repeat1(alias($.labeled_predicate, $.guard)),
      ),

    // WITH gives witnesses for refined variables, WITNESS for abstract
    // parameters; both hold labeled predicates.
    with_clause: ($) =>
      seq(kw('with'), repeat1(alias($.labeled_predicate, $.witness))),

    witness_clause: ($) =>
      seq(kw('witness'), repeat1(alias($.labeled_predicate, $.witness))),

    then_clause: ($) =>
      seq(choice(kw('then'), kw('begin')), repeat1($.action)),

    // ==========================
    // Actions
    // ==========================

    action: ($) =>
      seq(
        optional(field('label', $.label)),
        choice($.skip, $.assignment, $.becomes_member, $.becomes_such),
      ),

    skip: ($) => token(ci('skip')),

    // Deterministic (parallel) assignment x, y ≔ E, F and functional
    // override f(x) ≔ E.
    assignment: ($) =>
      seq(
        commaSep1(field('left', choice($.identifier, $.function_application))),
        choice('≔', alias(':=', '≔')),
        commaSep1(field('right', $._expression)),
      ),

    // Non-deterministic: becomes member of a set.
    becomes_member: ($) =>
      seq(
        commaSep1(field('left', $.identifier)),
        choice(':∈', alias('::', ':∈')),
        field('right', $._expression),
      ),

    // Non-deterministic: becomes such that a predicate holds.
    becomes_such: ($) =>
      seq(
        commaSep1(field('left', $.identifier)),
        choice(':∣', alias(':|', ':∣')),
        field('predicate', $._predicate),
      ),

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
          $._dot,
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
        $.binary_expression,
        $.unary_expression,
        $.inverse_expression,
        $.relational_image,
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
        $.function_override,
        $.parenthesized_expression,
        $.set_enumeration,
        $.set_comprehension,
        $.lambda_expression,
        $.quantified_union,
        $.quantified_inter,
        $.generalized_union,
        $.generalized_inter,
        $.bool_conversion,
        $.if_expression,
      ),

    binary_expression: ($) => {
      // [level, operator] — ASCII spellings alias to the canonical Unicode
      // operator, so consumers and queries see a single spelling. U+E100–E103
      // are the Rodin private-use code points for ⤨-style relation arrows and
      // relational override.
      const table = [
        // Pair constructor (maplet), left-associative.
        [EXPR.maplet, choice('↦', alias('|->', '↦'))],
        // Set-of-relations constructors (and rossi's ⦂ type ascription).
        [EXPR.arrow, choice('↔', alias('<->', '↔'))],
        [EXPR.arrow, choice(alias('', '<<->'), '<<->')],
        [EXPR.arrow, choice(alias('', '<->>'), '<->>')],
        [EXPR.arrow, choice(alias('', '<<->>'), '<<->>')],
        [EXPR.arrow, choice('⇸', alias('+->', '⇸'))],
        [EXPR.arrow, choice('→', alias('-->', '→'))],
        [EXPR.arrow, choice('⤔', alias('>+>', '⤔'))],
        [EXPR.arrow, choice('↣', alias('>->', '↣'))],
        [EXPR.arrow, choice('⤀', alias('+>>', '⤀'))],
        [EXPR.arrow, choice('↠', alias('->>', '↠'))],
        [EXPR.arrow, choice('⤖', alias('>->>', '⤖'))],
        [EXPR.arrow, choice('⦂', alias(ci('oftype'), '⦂'))],
        // Binary set operators.
        [EXPR.setop, choice('∪', alias('\\/', '∪'))],
        [EXPR.setop, choice('∩', alias('/\\', '∩'))],
        [EXPR.setop, choice('∖', alias('\\', '∖'))],
        [EXPR.setop, choice('×', alias('**', '×'))],
        [EXPR.setop, ';'],
        [EXPR.setop, choice('∘', alias(ci('circ'), '∘'))],
        [EXPR.setop, choice('⊕', alias('', '⊕'), alias('<+', '⊕'))],
        [EXPR.setop, choice('◁', alias('<|', '◁'))],
        [EXPR.setop, choice('⩤', alias('<<|', '⩤'))],
        [EXPR.setop, choice('▷', alias('|>', '▷'))],
        [EXPR.setop, choice('⩥', alias('|>>', '⩥'))],
        [EXPR.setop, choice('⊗', alias('><', '⊗'))],
        [EXPR.setop, choice('∥', alias('||', '∥'))],
        // Interval constructor.
        [EXPR.interval, choice('‥', alias('..', '‥'))],
        // Arithmetic.
        [EXPR.additive, '+'],
        [EXPR.additive, choice('−', alias('-', '−'))],
        [EXPR.multiplicative, choice('∗', alias('*', '∗'))],
        [EXPR.multiplicative, choice('÷', alias('/', '÷'))],
        [EXPR.multiplicative, alias(ci('mod'), 'mod')],
        [EXPR.exponent, '^'],
      ];
      return choice(
        ...table.map(([level, operator]) =>
          prec.left(
            level,
            seq(
              field('left', $._expression),
              field('operator', operator),
              field('right', $._expression),
            ),
          ),
        ),
      );
    },

    unary_expression: ($) =>
      prec(
        EXPR.unary,
        seq(
          field('operator', choice(
            choice('−', alias('-', '−')),
            choice('ℙ1', alias(ci('pow1'), 'ℙ1')),
            choice('ℙ', alias(ci('pow'), 'ℙ')),
            alias(ci('dom'), 'dom'),
            alias(ci('ran'), 'ran'),
          )),
          field('operand', $._expression),
        ),
      ),

    // Postfix converse: r∼ (r~).
    inverse_expression: ($) =>
      prec.left(
        EXPR.postfix,
        seq(field('operand', $._expression), choice('∼', alias('~', '∼'))),
      ),

    // Relational image: r[S].
    relational_image: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('relation', $._expression),
          '[',
          field('image', $._expression),
          ']',
        ),
      ),

    // Rodin's compact spelling of functional override: f{x ↦ y} is sugar for
    // f ⊕ {x ↦ y}.
    function_override: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field(
            'function',
            choice(
              $.identifier,
              $.builtin,
              $.function_application,
              $.function_override,
              $.parenthesized_expression,
              $.inverse_expression,
              $.relational_image,
            ),
          ),
          '{',
          commaSep1($._expression),
          '}',
        ),
      ),

    // ==========================
    // Set constructors and quantified expressions
    // ==========================

    set_enumeration: ($) => seq('{', commaSep1($._expression), '}'),

    // Three forms (kernel_lang §3.3.6, rossi grammar.pest):
    //   {x, y · P | E}   extended (explicit binders)
    //   {x, y | P}       basic with binder list
    //   {E | P}          expression form, e.g. {x ↦ y | P}
    // For a single bare identifier the binder and expression forms coincide;
    // dynamic precedence picks the binder reading, like rossi's PEG order.
    set_comprehension: ($) =>
      seq(
        '{',
        choice(
          prec.dynamic(
            2,
            seq(
              commaSep1(field('binder', $.typed_identifier)),
              $._dot,
              field('condition', $._predicate),
              $._pipe,
              field('body', $._expression),
            ),
          ),
          prec.dynamic(
            1,
            seq(
              commaSep1(field('binder', $.typed_identifier)),
              $._pipe,
              field('condition', $._predicate),
            ),
          ),
          seq(
            field('element', $._expression),
            $._pipe,
            field('condition', $._predicate),
          ),
        ),
        '}',
      ),

    // λ ident-pattern · P | E. The pattern is a left-associative maplet tree
    // over (possibly typed, possibly parenthesized) identifiers; ↦ binds to
    // the pattern, never to a type annotation (kernel_lang §3.3.6).
    lambda_expression: ($) =>
      prec.right(
        EXPR.quantified,
        seq(
          choice('λ', alias('%', 'λ')),
          field('pattern', $._ident_pattern),
          $._dot,
          field('condition', $._predicate),
          $._pipe,
          field('body', $._expression),
        ),
      ),

    _ident_pattern: ($) => choice($.maplet_pattern, $._ident_pattern_atom),

    maplet_pattern: ($) =>
      prec.left(
        seq(
          $._ident_pattern,
          choice('↦', alias('|->', '↦')),
          $._ident_pattern,
        ),
      ),

    _ident_pattern_atom: ($) =>
      choice(
        seq('(', $._ident_pattern, ')'),
        alias($.pattern_typed_identifier, $.typed_identifier),
      ),

    // A pattern binder's type annotation stops before any top-level ↦, which
    // belongs to the pattern (kernel_lang §3.3.6: types use × and the
    // relation arrows, never a bare maplet). prec.right at the arrow level
    // makes ↦ (level 2) reduce out of the type while arrows (level 3) still
    // extend it: λx⦂ℤ ↦ y⦂BOOL · … binds two variables.
    pattern_typed_identifier: ($) =>
      prec.right(
        EXPR.arrow,
        seq(
          field('name', $.identifier),
          optional(
            seq(
              choice('⦂', alias(ci('oftype'), '⦂')),
              field('type', $._expression),
            ),
          ),
        ),
      ),

    quantified_union: ($) =>
      prec.right(
        EXPR.quantified,
        seq(
          choice('⋃', alias(ci('union'), '⋃')),
          commaSep1(field('binder', $.typed_identifier)),
          $._dot,
          field('condition', $._predicate),
          $._pipe,
          field('body', $._expression),
        ),
      ),

    quantified_inter: ($) =>
      prec.right(
        EXPR.quantified,
        seq(
          choice('⋂', alias(ci('inter'), '⋂')),
          commaSep1(field('binder', $.typed_identifier)),
          $._dot,
          field('condition', $._predicate),
          $._pipe,
          field('body', $._expression),
        ),
      ),

    // Generalized union/inter of a set of sets: union(S), inter(S).
    generalized_union: ($) =>
      seq(
        choice('⋃', alias(ci('union'), '⋃')),
        '(',
        field('argument', $._expression),
        ')',
      ),

    generalized_inter: ($) =>
      seq(
        choice('⋂', alias(ci('inter'), '⋂')),
        '(',
        field('argument', $._expression),
        ')',
      ),

    // bool(P) converts a predicate to a BOOL value.
    bool_conversion: ($) =>
      seq(
        alias(token(ci('bool')), 'bool'),
        '(',
        field('predicate', $._predicate),
        ')',
      ),

    // IF P THEN E1 ELSE E2 END (ProB extension).
    if_expression: ($) =>
      seq(
        kw('if'),
        field('condition', $._predicate),
        kw('then'),
        field('consequence', $._expression),
        kw('else'),
        field('alternative', $._expression),
        kw('end'),
      ),

    _dot: ($) => choice('·', alias('.', '·')),
    _pipe: ($) => choice('∣', alias('|', '∣')),

    // The function position is an atom or another postfix expression, not an
    // arbitrary expression: f(x), prj1(s)(t), (E)(x), f∼(x), r[S](x).
    function_application: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field(
            'function',
            choice(
              $.identifier,
              $.builtin,
              $.function_application,
              $.parenthesized_expression,
              $.inverse_expression,
              $.relational_image,
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

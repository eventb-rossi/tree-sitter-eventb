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

/**
 * The canonical spelling of an operator plus its variant spellings (ASCII
 * forms, Rodin private-use code points, case-insensitive words), each aliased
 * to the canonical one so consumers and queries see a single spelling.
 */
function op(canonical, ...variants) {
  return choice(canonical, ...variants.map((v) => alias(v, canonical)));
}

/** One or more `rule`s separated by optional commas (identifier lists). */
function spaceSep1(rule) {
  return seq(rule, repeat(seq(optional(','), rule)));
}

/** One or more `rule`s separated by mandatory commas. */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/** A clause keyword holding labeled predicates surfaced as `item` nodes. */
function labeledClause($, keyword, item) {
  return seq(keyword, repeat1(alias($.labeled_predicate, item)));
}

/** A bound variable with an optional ⦂ type annotation. */
function typedBinder($) {
  return seq(
    field('name', $.identifier),
    optional(seq(op('⦂', ci('oftype')), field('type', $._expression))),
  );
}

/** A quantified set operation: ⋃/⋂ binders · P ∣ E. */
function quantifiedSetOp($, operator) {
  return prec.right(
    EXPR.quantified,
    seq(
      operator,
      commaSep1(field('binder', $.typed_identifier)),
      $._dot,
      field('condition', $._predicate),
      $._pipe,
      field('body', $._expression),
    ),
  );
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

// Expression precedence, lowest → highest (kernel_lang §3.3.4, Table 3.1),
// except that the relation arrows and ⦂ bind looser than ↦, matching rossi's
// grammar.pest (relation_type_expr wraps maplet_expr): `a ↦ b ↔ c` is
// `(a ↦ b) ↔ c`. Note kernel_lang Table 3.1 orders these two levels the
// other way around — rossi diverges from the spec there, and rossi's own
// formatter emits maplet–arrow mixes unparenthesized, so only rossi's ladder
// round-trips rossi-produced text.
// Like rossi, levels the spec declares non-associative (relation arrows,
// interval, exponent) parse left-associated chains permissively; the set
// operator compatibility matrix (Table 3.2) is likewise a semantic check,
// not a parse-time one. Unary minus binds tighter than `^`, matching rossi's
// grammar.pest (`-a^b` is `(-a)^b`) rather than the spec's arithmetic level.
const EXPR = {
  quantified: 1,
  arrow: 2,
  maplet: 3,
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

  // Hidden choice rules exposed as supertypes in node-types.json, so query
  // authors and typed-binding generators can say "any expression" without
  // enumerating (and drifting from) the alternatives.
  supertypes: ($) => [$._expression, $._predicate],

  conflicts: ($) => [
    // Predicates and expressions share atoms (true/false, parentheses): in
    // `(true)` the parser cannot know locally whether it is closing a
    // parenthesized predicate or a parenthesized expression that a relational
    // operator will follow. GLR keeps both readings until one completes.
    [$._predicate, $._expression],
    // The same atoms are also postfix heads (`TRUE(x)`, `bool(P)(x)`), so the
    // head reading stays alive alongside both of the above.
    [$._predicate, $._postfix_head],
    [$._expression, $._postfix_head],
    // In `{x, …` an identifier is either a comprehension binder or the first
    // element of a set enumeration (or the expression form's element).
    [$.typed_identifier, $._expression],
    // `bool` followed by `(` is a predicate-to-BOOL conversion, but `bool`
    // is also the BOOL type literal.
    [$.bool_conversion, $.bool_set],
    // `if` opens an IF/THEN/ELSE expression or names an identifier (rossi
    // backtracks); the continuation decides.
    [$._identifier_like, $.if_expression],
    // `theorem` after a label flags the predicate, or starts it as an
    // identifier expression.
    [$._identifier_like, $.labeled_predicate],
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
        field('name', $._component_name),
        repeat($._context_clause),
        kw('end'),
      ),

    // Component names are Rodin file names, which may contain hyphens
    // (ENV_C-1). The hyphen parts attach with token.immediate so a name is
    // distinguished from subtraction; in name positions no expression is
    // valid anyway.
    _component_name: ($) => choice($.identifier, $.component_name),

    component_name: ($) =>
      seq($.identifier, repeat1(token.immediate(/-[a-zA-Z0-9_']+/))),

    _context_clause: ($) =>
      choice(
        $.extends_clause,
        $.sets_clause,
        $.constants_clause,
        $.axioms_clause,
        $.theorems_clause,
      ),

    extends_clause: ($) => seq(kw('extends'), spaceSep1($._component_name)),

    sets_clause: ($) => seq(kw('sets'), spaceSep1($.set_declaration)),

    // Deferred set (S) or enumerated set (S = {a, b, c}).
    set_declaration: ($) =>
      seq(
        field('name', $.identifier),
        optional(seq('=', '{', commaSep1($.identifier), '}')),
      ),

    constants_clause: ($) => seq(kw('constants'), spaceSep1($.identifier)),

    axioms_clause: ($) => labeledClause($, kw('axioms'), $.axiom),

    // A THEOREMS section holds theorem-flagged axioms (in a context) or
    // invariants (in a machine); Rodin models the flag as an attribute, not a
    // separate container.
    theorems_clause: ($) => labeledClause($, kw('theorems'), $.theorem),

    // ==========================
    // Machine
    // ==========================

    machine: ($) =>
      seq(
        kw('machine'),
        field('name', $._component_name),
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

    refines_clause: ($) =>
      seq(kw('refines'), field('target', $._component_name)),

    sees_clause: ($) => seq(kw('sees'), spaceSep1($._component_name)),

    variables_clause: ($) => seq(kw('variables'), spaceSep1($.identifier)),

    invariants_clause: ($) => labeledClause($, kw('invariants'), $.invariant),

    variant_clause: ($) =>
      seq(kw('variant'), field('expression', $._expression)),

    // ==========================
    // Events
    // ==========================

    events_clause: ($) => seq(kw('events'), repeat1($.event)),

    // The INITIALISATION event needs no special rule: its name parses as a
    // plain identifier (there is no `initialisation` keyword token to shadow
    // it). Event names and refinement targets are Rodin event labels, which
    // may be hyphenated like component names. The sub-clauses follow
    // grammar.pest: refines/extends may follow the name directly, or refines
    // (only) may follow a status clause (event_body); the remaining clauses
    // come in a fixed order, each at most once.
    event: ($) => {
      const refines = seq(kw('refines'), field('refines', $._component_name));
      return seq(
        optional(field('convergence', $._convergence)),
        kw('event'),
        field('name', $._component_name),
        optional(
          choice(
            seq(
              choice(
                refines,
                seq(kw('extends'), field('extends', $._component_name)),
              ),
              optional($.status_clause),
            ),
            seq($.status_clause, optional(refines)),
          ),
        ),
        optional($.any_clause),
        optional($.where_clause),
        optional($.with_clause),
        optional($.witness_clause),
        optional($.then_clause),
        kw('end'),
      );
    },

    _convergence: ($) =>
      choice(kw('ordinary'), kw('convergent'), kw('anticipated')),

    status_clause: ($) =>
      seq(kw('status'), field('convergence', $._convergence)),

    any_clause: ($) =>
      seq(kw('any'), spaceSep1(field('parameter', $.identifier))),

    where_clause: ($) =>
      labeledClause($, choice(kw('where'), kw('when')), $.guard),

    // WITH gives witnesses for refined variables, WITNESS for abstract
    // parameters; both hold labeled predicates.
    with_clause: ($) => labeledClause($, kw('with'), $.witness),

    witness_clause: ($) => labeledClause($, kw('witness'), $.witness),

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
    // override f(x) ≔ E. The assigned variables are identifiers (including
    // the operator-word fallbacks: a variable may be named `dom`).
    assignment: ($) =>
      seq(
        commaSep1(
          field(
            'left',
            choice($.identifier, $._identifier_like, $.function_application),
          ),
        ),
        op('≔', ':='),
        commaSep1(field('right', $._expression)),
      ),

    // Non-deterministic: becomes member of a set.
    becomes_member: ($) =>
      seq(
        commaSep1(field('left', choice($.identifier, $._identifier_like))),
        op(':∈', '::'),
        field('right', $._expression),
      ),

    // Non-deterministic: becomes such that a predicate holds.
    becomes_such: ($) =>
      seq(
        commaSep1(field('left', choice($.identifier, $._identifier_like))),
        op(':∣', ':|'),
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
          field('quantifier', choice(op('∀', '!'), op('∃', '#'))),
          commaSep1(field('binder', $.typed_identifier)),
          $._dot,
          field('body', $._predicate),
        ),
      ),

    binary_predicate: ($) => {
      const table = [
        [PRED.equivalence, op('⇔', '<=>')],
        [PRED.implication, op('⇒', '=>')],
        [PRED.disjunction, op('∨', ci('or'))],
        [PRED.conjunction, op('∧', '&')],
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

    // The dynamic precedence prefers the operator reading when `not` could
    // also start an identifier expression, matching pest's alternative order.
    not_predicate: ($) =>
      prec(
        PRED.negation,
        prec.dynamic(
          1,
          seq(
            field('operator', op('¬', ci('not'))),
            field('operand', $._predicate),
          ),
        ),
      ),

    // Operands are expressions, never comparisons, so relational operators
    // are non-associative by construction (x = y = z is ill-formed).
    comparison_predicate: ($) =>
      seq(
        field('left', $._expression),
        field('operator', choice(
          '=',
          op('≠', '/='),
          op('≤', '<='),
          op('≥', '>='),
          '<',
          '>',
          op('∈', ':'),
          op('∉', '/:'),
          op('⊂', '<<:'),
          op('⊄', '/<<:'),
          op('⊆', '<:'),
          op('⊈', '/<:'),
        )),
        field('right', $._expression),
      ),

    parenthesized_predicate: ($) => seq('(', $._predicate, ')'),

    // Bound variable with optional type annotation: x⦂T (Rodin's bcc output
    // spells types this way after type-checking).
    typed_identifier: ($) => typedBinder($),

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
        $.bool_conversion,
        $.if_expression,
        $._identifier_like,
      ),

    // Words that are operators only in specific forms fall back to ordinary
    // identifiers elsewhere, like in rossi, where the PEG backtracks: `union`
    // and `inter` are operators only when a quantified form follows (the
    // generalized union of kernel_lang, union(S), is an identifier
    // application there too; capitalised spellings like `Union` are real
    // identifiers in published models), and dom/ran/pow/pow1/not/if/theorem
    // likewise name constants or variables in rossi-valid models. GLR keeps
    // both readings alive until the continuation decides; dynamic precedence
    // on the operator rules prefers the operator reading on ties, matching
    // pest's alternative order.
    _identifier_like: ($) =>
      choice(
        alias(ci('union'), $.identifier),
        alias(ci('inter'), $.identifier),
        alias(ci('dom'), $.identifier),
        alias(ci('ran'), $.identifier),
        alias(ci('pow'), $.identifier),
        alias(ci('pow1'), $.identifier),
        alias(ci('not'), $.identifier),
        alias(ci('if'), $.identifier),
        alias(ci('theorem'), $.identifier),
      ),

    binary_expression: ($) => {
      // [level, operator] — variant spellings alias to the canonical
      // operator, so consumers and queries see a single spelling. U+E100–E103
      // are the Rodin private-use code points for the relation-set arrows and
      // relational override; the first three have no real Unicode equivalent,
      // so their ASCII spellings are the canonical ones.
      const table = [
        // Set-of-relations constructors (and rossi's ⦂ type ascription),
        // loosest after quantification — see the EXPR comment above.
        [EXPR.arrow, op('↔', '<->')],
        [EXPR.arrow, op('<<->', '')],
        [EXPR.arrow, op('<->>', '')],
        [EXPR.arrow, op('<<->>', '')],
        [EXPR.arrow, op('⇸', '+->')],
        [EXPR.arrow, op('→', '-->')],
        [EXPR.arrow, op('⤔', '>+>')],
        [EXPR.arrow, op('↣', '>->')],
        [EXPR.arrow, op('⤀', '+>>')],
        [EXPR.arrow, op('↠', '->>')],
        [EXPR.arrow, op('⤖', '>->>')],
        [EXPR.arrow, op('⦂', ci('oftype'))],
        // Pair constructor (maplet), left-associative.
        [EXPR.maplet, op('↦', '|->')],
        // Binary set operators.
        [EXPR.setop, op('∪', '\\/')],
        [EXPR.setop, op('∩', '/\\')],
        [EXPR.setop, op('∖', '\\')],
        [EXPR.setop, op('×', '**')],
        [EXPR.setop, ';'],
        [EXPR.setop, op('∘', ci('circ'))],
        [EXPR.setop, op('⊕', '', '<+')],
        [EXPR.setop, op('◁', '<|')],
        [EXPR.setop, op('⩤', '<<|')],
        [EXPR.setop, op('▷', '|>')],
        [EXPR.setop, op('⩥', '|>>')],
        [EXPR.setop, op('⊗', '><')],
        [EXPR.setop, op('∥', '||')],
        // Interval constructor.
        [EXPR.interval, op('‥', '..')],
        // Arithmetic.
        [EXPR.additive, '+'],
        [EXPR.additive, op('−', '-')],
        [EXPR.multiplicative, op('∗', '*')],
        [EXPR.multiplicative, op('÷', '/')],
        [EXPR.multiplicative, kw('mod')],
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

    // The dynamic precedence prefers the operator reading of dom/ran/pow/pow1
    // over an identifier application when both complete (`dom(S)`), matching
    // pest's alternative order.
    unary_expression: ($) =>
      prec(
        EXPR.unary,
        prec.dynamic(
          1,
          seq(
            field('operator', choice(
              op('−', '-'),
              op('ℙ1', ci('pow1')),
              op('ℙ', ci('pow')),
              kw('dom'),
              kw('ran'),
            )),
            field('operand', $._expression),
          ),
        ),
      ),

    // Postfix converse: r∼ (r~).
    inverse_expression: ($) =>
      prec.left(
        EXPR.postfix,
        seq(field('operand', $._expression), op('∼', '~')),
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
          field('function', $._postfix_head),
          '{',
          commaSep1($._expression),
          '}',
        ),
      ),

    // ==========================
    // Set constructors and quantified expressions
    // ==========================

    // `{}` without inner space lexes as the empty_set token; `{ }` parses
    // here as an empty enumeration, like rossi.
    set_enumeration: ($) => seq('{', optional(commaSep1($._expression)), '}'),

    // Three forms (kernel_lang §3.3.6, rossi grammar.pest):
    //   {x, y · P | E}   extended (explicit binders)
    //   {x, y | P}       basic with binder list
    //   {E | P}          expression form, e.g. {x ↦ y | P}
    // For a single bare identifier the binder and expression forms coincide;
    // dynamic precedence picks the binder reading, like rossi's PEG order.
    // (The extended form needs no dynamic preference: its mandatory `·`
    // cannot occur in either competing reading.)
    set_comprehension: ($) =>
      seq(
        '{',
        choice(
          seq(
            commaSep1(field('binder', $.typed_identifier)),
            $._dot,
            field('condition', $._predicate),
            $._pipe,
            field('body', $._expression),
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
          op('λ', '%'),
          field('pattern', $._ident_pattern),
          $._dot,
          field('condition', $._predicate),
          $._pipe,
          field('body', $._expression),
        ),
      ),

    _ident_pattern: ($) => choice($.maplet_pattern, $._ident_pattern_atom),

    maplet_pattern: ($) =>
      prec.left(seq($._ident_pattern, op('↦', '|->'), $._ident_pattern)),

    _ident_pattern_atom: ($) =>
      choice(
        seq('(', $._ident_pattern, ')'),
        alias($.pattern_typed_identifier, $.typed_identifier),
      ),

    // A pattern binder's type annotation stops before any top-level ↦, which
    // belongs to the pattern (kernel_lang §3.3.6: types use × and the
    // relation arrows, never a bare maplet; rossi's ident_binder_type
    // likewise excludes ↦). prec.left at the maplet level makes a ↦ after
    // the type reduce the typed identifier (tie at the maplet level, left →
    // reduce) so it separates binders; arrows and a nested ⦂ can never follow
    // a complete pattern, so they extend the type with no conflict:
    // λx⦂ℤ ↦ y⦂BOOL · … binds two variables, λf⦂ℤ ⇸ ℤ · … binds one.
    pattern_typed_identifier: ($) => prec.left(EXPR.maplet, typedBinder($)),

    quantified_union: ($) => quantifiedSetOp($, op('⋃', ci('union'))),

    quantified_inter: ($) => quantifiedSetOp($, op('⋂', ci('inter'))),

    // bool(P) converts a predicate to a BOOL value.
    bool_conversion: ($) =>
      seq(kw('bool'), '(', field('predicate', $._predicate), ')'),

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

    _dot: ($) => op('·', '.'),
    _pipe: ($) => op('∣', '|'),

    // What a postfix form may apply to: grammar.pest's primary_expr — atoms,
    // literals, parenthesized expressions, set constructors, and other
    // postfix expressions (so postfixes chain: f(x)[S]∼). Quantified forms
    // participate via parentheses only. Shared by function application and
    // the override sugar; relational_image and inverse_expression take a
    // full expression at postfix precedence, which climbing makes equivalent.
    _postfix_head: ($) =>
      choice(
        $.identifier,
        $._identifier_like,
        $.builtin,
        $.number,
        $.string,
        $.true,
        $.false,
        $.integer_set,
        $.natural_set,
        $.natural1_set,
        $.bool_set,
        $.empty_set,
        $.bool_conversion,
        $.if_expression,
        $.function_application,
        $.function_override,
        $.parenthesized_expression,
        $.inverse_expression,
        $.relational_image,
        $.set_enumeration,
        $.set_comprehension,
      ),

    function_application: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('function', $._postfix_head),
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
    // Unsigned, unlike rossi's signed integer literal: a leading minus parses
    // as unary minus, so `x-1` cannot lex as `x` `(-1)`.
    number: ($) => /[0-9]+/,
    // Per the TextEditor EBNF: all characters following `@` belong to the
    // label until the next whitespace character.
    label: ($) => /@[^\s]+/,
    // Only \" and \\ escapes, like rossi's string_inner.
    string: ($) => token(seq('"', repeat(choice(/[^"\\]/, /\\["\\]/)), '"')),
    comment: ($) =>
      token(
        choice(
          seq('//', /[^\n]*/),
          seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
        ),
      ),
  },
});

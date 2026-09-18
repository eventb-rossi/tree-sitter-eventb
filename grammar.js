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
// - Two keyword classes, following rossi's grammar.pest. STRUCTURAL keywords
//   (context, machine, sees, event, then, end, theorem, skip, …) are
//   case-insensitive: each is a regex token (via `ci`/`kw`) aliased to its
//   canonical lowercase spelling, so queries match plain strings. MATH/logic
//   keywords are exact-case, matching the kernel language — uppercase NAT,
//   INT, BOOL, TRUE, FALSE, POW, POW1, UNION, INTER and lowercase true, false,
//   bool, dom, ran, mod, circ, or, not, oftype — so `nat`, `Union`, `DOM` are
//   ordinary identifiers. No keyword token carries lexical precedence: plain
//   longest-match keeps identifiers whole, and the `word` directive below
//   resolves exact-length ties in the keyword's favour, which also terminates
//   whitespace-separated identifier lists at the next clause keyword.
// - Structural identifier/reference lists are whitespace-separated; commas are
//   meaningful only inside formulas (set enumerations, argument lists).

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

/** One or more `rule`s separated by whitespace (structural identifier lists;
 * rossi's grammar.pest no longer accepts commas here). */
function spaceSep1(rule) {
  return repeat1(rule);
}

/** One or more `rule`s separated by mandatory commas. */
function commaSep1(rule) {
  return seq(rule, repeat(seq(',', rule)));
}

/** A clause keyword holding labeled predicates surfaced as `item` nodes. */
function labeledClause($, keyword, item) {
  return seq(keyword, repeat1(alias($.labeled_predicate, item)));
}

/**
 * A comma-separated assignment LHS: identifiers, including the operator-word
 * fallbacks (a variable may be named `dom`), plus any `extra` heads — the `≔`
 * form also allows a `function_application` for `f(x) ≔ E`.
 */
function assignTargets($, ...extra) {
  return commaSep1(
    field('left', choice($.identifier, $._identifier_like, ...extra)),
  );
}

/** A bound variable with an optional ⦂ type annotation. */
function typedBinder($) {
  return seq(
    field('name', $.identifier),
    optional(seq(op('⦂', 'oftype'), field('type', $._expression))),
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
// scope extends as far right as possible; ¬ binds tightest. Following rossi's
// grammar.pest, ⇒ and ⇔ share one level (implies_equiv) and ∧ and ∨ share one
// level (connective): they are not precedence ladders but mutually
// incompatible operators that must be parenthesized when mixed. Like rossi we
// fold each level flat (left-associated) and leave the mixing/chaining
// rejection to semantic tooling.
const PRED = {
  quantified: 1,
  implies_equiv: 2,
  connective: 3,
  negation: 4,
};

// Expression precedence, lowest → highest (kernel_lang §3.3.4, Table 3.1).
// The pair constructor `↦` (group 2) is the loosest binary operator, looser
// than the relation-set arrows and `⦂` (group 3): `a ↦ b ↔ c` is
// `a ↦ (b ↔ c)`, matching rossi's grammar.pest (maplet_expr wraps
// relation_type_expr) and the spec.
// Like rossi, levels the spec declares non-associative (relation arrows,
// interval, exponent) parse left-associated chains permissively; the set
// operator compatibility matrix (Table 3.2) is likewise a semantic check,
// not a parse-time one. Unary minus parses at the additive level
// (kernel_lang §3.3.4 ⟨arithmetic-expr⟩ ::= ['-'] ⟨term⟩ …), matching
// rossi's grammar.pest: the sign takes a whole multiplicative or
// exponent term (`-a*b` is `-(a*b)`) while an additive continuation stays
// outside (`-a+b` keeps `(-a)+b`). One permissive corner: after `^` the
// sign also swallows a following tight chain (`2^-3*4` groups as
// `2^(-(3*4))` where pest reads `(2^(-3))*4`) — no corpus source spells
// a minus after `^`, and this grammar's job is structure, not rejection.
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

// Event-B's whitespace, as Rodin's math lexer defines it (see `extras` below):
// every Unicode Zs/Zl/Zp separator, plus U+0009..U+000D and U+001C..U+001F.
const WHITESPACE =
  /[\t-\r\x1C-\x1F \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]/;

// `@` followed by everything up to the next separator — the complement of
// WHITESPACE, so the label boundary and the token boundary stay in lockstep.
const NOT_WHITESPACE_PLUS_AT =
  /@[^\t-\r\x1C-\x1F \u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000]+/;

export default grammar({
  name: 'eventb',

  // Whitespace separates tokens; comments are nodes (so they highlight) but
  // are skippable anywhere.
  //
  // The class is spelled out rather than written `/\s/`, which tree-sitter
  // compiles to ASCII only (`('\t' <= c && c <= '\r') || c == ' '`). Event-B's
  // separator set is Rodin's: `LexicalClass.isWhitespace(cp)` in
  // `org.eventb.core.ast` is `Character.isWhitespace(cp) ||
  // FormulaFactory.isEventBWhiteSpace(cp)`, and because the latter ORs in
  // `Character.isSpaceChar` the usual NBSP / U+2007 / U+202F carve-out is
  // cancelled — leaving every Unicode Zs/Zl/Zp separator plus U+0009..U+000D
  // and U+001C..U+001F. U+0085 (Cc) and U+200B (Cf) are deliberately absent:
  // Rodin does not separate on them, and neither does rossi's `grammar.pest`.
  extras: ($) => [WHITESPACE, $.comment],

  // Keyword extraction: a whole-word token that exactly matches a keyword
  // resolves to the keyword where the keyword is valid, and to `identifier`
  // elsewhere. This is what makes keywords reserved words.
  word: ($) => $.identifier,

  // Hidden choice rules exposed as supertypes in node-types.json, so query
  // authors and typed-binding generators can say "any expression" without
  // enumerating (and drifting from) the alternatives.
  supertypes: ($) => [$._expression, $._predicate],

  conflicts: ($) => [
    // `f(` opens an expression application (a postfix head, then `(`) or a
    // predicate application, and an item's label means a formula is never the
    // first token of a clause member, so this is the only place the two
    // readings meet. The argument list and what follows the `)` decide, so
    // both stay alive until then.
    [$._postfix_head, $.predicate_application],
    // In `{x, …` an identifier is either a comprehension binder or the first
    // element of a set enumeration (or the expression form's element).
    [$.typed_identifier, $._expression],
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
      seq($.identifier, repeat1(token.immediate(/-[a-zA-Z0-9_]+/))),

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

    // A carrier set is a name and nothing else. The enumerated form
    // `S = {a, b, c}` belongs to classical B (probparsers' `BParser.scc`
    // spells it `enumerated_set`), not to Event-B: Camille's `EventBParser.scc`
    // declares an `=` token and uses it in no production, Rodin's
    // `contextFile.dtd` gives `carrierSet` an EMPTY content model, and rossi's
    // grammar.pest `context_clause_sets` takes identifiers only. The node is
    // kept so a set name still highlights differently from a constant.
    set_declaration: ($) => field('name', $.identifier),

    constants_clause: ($) => seq(kw('constants'), spaceSep1($.identifier)),

    axioms_clause: ($) => labeledClause($, kw('axioms'), $.axiom),

    // A THEOREMS section holds theorem-flagged axioms (in a context) or
    // invariants (in a machine); Rodin models the flag as an attribute, not a
    // separate container.
    theorems_clause: ($) => labeledClause($, kw('theorems'), $.theorem),

    // ==========================
    // Machine
    // ==========================

    // EVENTS is the final machine section (grammar.pest machine_body): the
    // other clauses repeat in any order, then an optional EVENTS block closes
    // the machine before END.
    machine: ($) =>
      seq(
        kw('machine'),
        field('name', $._component_name),
        repeat($._machine_clause),
        optional($.events_clause),
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
      ),

    refines_clause: ($) =>
      seq(kw('refines'), field('target', $._component_name)),

    sees_clause: ($) => seq(kw('sees'), spaceSep1($._component_name)),

    variables_clause: ($) => seq(kw('variables'), spaceSep1($.identifier)),

    invariants_clause: ($) => labeledClause($, kw('invariants'), $.invariant),

    // Several variants form a lexicographic sequence. The first item may be
    // unlabeled; every following label delimits the next expression.
    variant_clause: ($) =>
      seq(
        kw('variant'),
        $.variant_item,
        repeat(alias($._labeled_variant_item, $.variant_item)),
      ),

    variant_item: ($) =>
      seq(
        optional(field('label', $.label)),
        field('expression', $._expression),
      ),

    _labeled_variant_item: ($) =>
      seq(
        field('label', $.label),
        field('expression', $._expression),
      ),

    // ==========================
    // Events
    // ==========================

    events_clause: ($) => seq(kw('events'), repeat1($.event)),

    // The INITIALISATION event needs no special rule: its name parses as a
    // plain identifier (there is no `initialisation` keyword token to shadow
    // it). Event names and refinement targets are Rodin event labels, which
    // may be hyphenated like component names. Several refinement targets
    // represent a merged event. The sub-clauses follow grammar.pest:
    // refines/extends may follow the name directly, or refines (only) may
    // follow a status clause (event_body); the remaining clauses come in a
    // fixed order, each at most once.
    event: ($) => {
      const refines = seq(
        kw('refines'),
        spaceSep1(field('refines', $._component_name)),
      );
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

    // The label is mandatory, as it is on a predicate.
    action: ($) =>
      seq(
        field('label', $.label),
        choice($.skip, $.assignment, $.becomes_member, $.becomes_such),
      ),

    skip: ($) => token(ci('skip')),

    // Deterministic (parallel) assignment x, y ≔ E, F and functional
    // override f(x) ≔ E. The assigned variables are identifiers (including
    // the operator-word fallbacks: a variable may be named `dom`).
    assignment: ($) =>
      seq(
        assignTargets($, $.function_application),
        op('≔', ':='),
        commaSep1(field('right', $._expression)),
      ),

    // Non-deterministic: becomes member of a set.
    becomes_member: ($) =>
      seq(
        assignTargets($),
        op(':∈', '::'),
        field('right', $._expression),
      ),

    // Non-deterministic: becomes such that a predicate holds.
    becomes_such: ($) =>
      seq(
        assignTargets($),
        op(':∣', ':|'),
        field('predicate', $._predicate),
      ),

    // ==========================
    // Labeled predicates
    // ==========================

    // Accepts "@label P", "theorem @label P" and "@label theorem P". The label
    // is mandatory: Camille's grammar and XEventB's both require one, and
    // Rodin's static checker reports a missing one as "Label missing", so a
    // bare "P" is not Event-B in any of the three.
    labeled_predicate: ($) =>
      seq(
        choice(
          seq(kw('theorem'), field('label', $.label)),
          seq(field('label', $.label), optional(kw('theorem'))),
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
        $.predicate_application,
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
        [PRED.implies_equiv, op('⇔', '<=>')],
        [PRED.implies_equiv, op('⇒', '=>')],
        [PRED.connective, op('∨', 'or')],
        [PRED.connective, op('∧', '&')],
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
            field('operator', op('¬', 'not')),
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
        $.closed_unary_expression,
        $.identifier,
        $.number,
        $.bool_true,
        $.bool_false,
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
        $._identifier_like,
      ),

    // The exact-case operator words that can also name a constant or variable
    // fall back to ordinary identifiers, like rossi where the AST builder reads
    // a bare `dom`/`ran`/`not` as an identifier (then rejects it as reserved —
    // a semantic check left to tooling). The uppercase operators (POW, UNION,
    // …) and the now-keyword-free `if`/`union`/`inter`/`pow` need no fallback:
    // their identifier spellings differ from the exact operator spelling, so
    // they already lex as plain identifiers. `theorem` stays case-insensitive
    // (a structural flag). GLR keeps both readings alive until the
    // continuation decides; dynamic precedence on the operator rules prefers
    // the operator reading on ties, matching pest's alternative order.
    _identifier_like: ($) =>
      choice(
        alias('dom', $.identifier),
        alias('ran', $.identifier),
        alias('not', $.identifier),
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
        // tighter than the maplet, looser than the binary set operators.
        [EXPR.arrow, op('↔', '<->')],
        [EXPR.arrow, op('<<->', '')],
        [EXPR.arrow, op('<->>', '')],
        [EXPR.arrow, op('<<->>', '')],
        [EXPR.arrow, op('⇸', '+->')],
        [EXPR.arrow, op('→', '-->')],
        [EXPR.arrow, op('⤔', '>+>')],
        [EXPR.arrow, op('↣', '>->')],
        [EXPR.arrow, op('⤀', '+>>', '+->>')],
        [EXPR.arrow, op('↠', '->>', '-->>')],
        [EXPR.arrow, op('⤖', '>->>')],
        [EXPR.arrow, op('⦂', 'oftype')],
        // Pair constructor (maplet), the loosest binary operator,
        // left-associative; `,,` is an accepted input spelling for ↦.
        [EXPR.maplet, op('↦', '|->', ',,')],
        // Binary set operators.
        [EXPR.setop, op('∪', '\\/')],
        [EXPR.setop, op('∩', '/\\')],
        [EXPR.setop, op('∖', '\\')],
        [EXPR.setop, op('×', '**')],
        [EXPR.setop, ';'],
        [EXPR.setop, op('∘', 'circ')],
        [EXPR.setop, op('<+', '')],
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
        [EXPR.multiplicative, 'mod'],
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

    // Prefix unary operators: unary minus and the powersets ℙ/ℙ1 (POW/POW1).
    // Unary minus sits at additive precedence with left resolution, so a
    // tighter operator shifts into its operand (`-a*b` is `-(a*b)`) while
    // an equal-precedence `+`/`-` reduces first (`-a+b` is `(-a)+b`); the
    // powersets keep the tight prefix level. The dynamic precedence prefers
    // the operator reading of pow/pow1 over an identifier application when
    // both complete, matching pest's alternative order.
    unary_expression: ($) =>
      choice(
        prec.left(
          EXPR.additive,
          seq(
            field('operator', op('−', '-')),
            field('operand', $._expression),
          ),
        ),
        prec(
          EXPR.unary,
          prec.dynamic(
            1,
            seq(
              field('operator', choice(
                op('ℙ1', 'POW1'),
                op('ℙ', 'POW'),
              )),
              field('operand', $._expression),
            ),
          ),
        ),
      ),

    // Closed unary application: dom(E) / ran(E), with mandatory parentheses
    // (Rodin's UnaryExpressionParser; kernel_lang §3.3.6 ⟨unary-op⟩ '(' E ')').
    // Sits at postfix precedence as a postfix head so it binds like Rodin:
    // dom(f)(x) = (dom(f))(x), dom(f)∼ = (dom(f))∼.
    closed_unary_expression: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('operator', choice('dom', 'ran')),
          '(',
          field('operand', $._expression),
          ')',
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
    // f <+ {x ↦ y}.
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
      prec.left(seq($._ident_pattern, op('↦', '|->', ',,'), $._ident_pattern)),

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

    quantified_union: ($) => quantifiedSetOp($, op('⋃', 'UNION')),

    quantified_inter: ($) => quantifiedSetOp($, op('⋂', 'INTER')),

    // bool(P) converts a predicate to a BOOL value (lowercase exact `bool`,
    // distinct from the uppercase BOOL type).
    bool_conversion: ($) =>
      seq('bool', '(', field('predicate', $._predicate), ')'),

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
        $.bool_true,
        $.bool_false,
        $.integer_set,
        $.natural_set,
        $.natural1_set,
        $.bool_set,
        $.empty_set,
        $.bool_conversion,
        $.closed_unary_expression,
        $.function_application,
        $.function_override,
        $.parenthesized_expression,
        $.inverse_expression,
        $.relational_image,
        $.set_enumeration,
        $.set_comprehension,
      ),

    // Expression application, single-argument like Rodin's FUNIMAGE: `f(x)`,
    // with a pair written as a maplet `f(x ↦ y)`, never a comma list. Rodin's
    // parser for it reads one expression and then demands `)`
    // (`SubParsers.BinaryLedExprParser` over the singular `EXPR_PARSER`), and
    // rossi's grammar.pest `function_application` does the same.
    function_application: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('function', $._postfix_head),
          '(',
          field('argument', $._expression),
          ')',
        ),
      ),

    // Predicate application, where the comma list lives: `partition(S, A, B)`
    // is Rodin's only multi-argument construct (`MultiplePredicate`, the sole
    // user of `EXPR_LIST_PARSER`) and it is a predicate, not an expression.
    // Like rossi's grammar.pest `predicate_application` the head is any
    // identifier-shaped word, and which heads actually resolve is left to
    // tooling (rossi answers with `BuiltinPredicate::from_name`).
    //
    // The same `f(x)` text is a predicate application here and an expression
    // application in the left of a comparison. That is a positional
    // difference, not one that needs types, so the `[$._postfix_head,
    // $.predicate_application]` conflict above keeps both readings alive
    // until the continuation decides, and `x = c(1, 2)` has no reading.
    predicate_application: ($) =>
      seq(
        field('function', choice($.identifier, $._identifier_like, $.builtin)),
        '(',
        commaSep1(field('argument', $._expression)),
        ')',
      ),

    parenthesized_expression: ($) => seq('(', $._expression, ')'),

    // ==========================
    // Atomic constants and builtins
    // ==========================

    // Predicate literals (lowercase exact + Unicode glyphs). Distinct from the
    // boolean values TRUE/FALSE (bool_true/bool_false) and the BOOL type
    // (bool_set): true/⊤ and false/⊥ live only in predicate position.
    true: ($) => token(choice('true', '⊤')),
    false: ($) => token(choice('false', '⊥')),
    // Boolean values (uppercase exact, no Unicode glyph): elements of BOOL.
    bool_true: ($) => 'TRUE',
    bool_false: ($) => 'FALSE',
    // Number-set and BOOL type atoms — uppercase ASCII exact, matching the
    // kernel language; the Unicode forms are canonical.
    integer_set: ($) => token(choice('ℤ', 'INT')),
    natural_set: ($) => token(choice('ℕ', 'NAT')),
    natural1_set: ($) => token(choice('ℕ1', 'NAT1')),
    bool_set: ($) => token('BOOL'),
    empty_set: ($) => token(choice('∅', '{}')),
    // Support functions/predicates — exact-case (lowercase) reserved words.
    builtin: ($) =>
      token(
        choice(
          'card',
          'finite',
          'id',
          'max',
          'min',
          'partition',
          'pred',
          'prj1',
          'prj2',
          'succ',
        ),
      ),

    // ==========================
    // Lexical tokens
    // ==========================

    // Mathematical identifier (kernel_lang §2.2): an optional single trailing
    // prime marks an Event-B after-state variable (`x'`); the prime never
    // repeats nor appears interior (`x''`, `x'y` are two tokens), matching
    // Rodin's lexer.
    identifier: ($) => /[a-zA-Z_][a-zA-Z0-9_]*'?/,
    // Unsigned, unlike rossi's signed integer literal: a leading minus parses
    // as unary minus, so `x-1` cannot lex as `x` `(-1)`.
    number: ($) => /[0-9]+/,
    // Per the TextEditor EBNF: all characters following `@` belong to the
    // label until the next whitespace character. The negated class must be the
    // same set `extras` skips, or a label ends where the parser does not —
    // rossi wires `label_text` to its `WHITESPACE` rule for exactly this
    // reason.
    label: ($) => NOT_WHITESPACE_PLUS_AT,
    comment: ($) =>
      token(
        choice(
          seq('//', /[^\n]*/),
          seq('/*', /[^*]*\*+([^/*][^*]*\*+)*/, '/'),
        ),
      ),
  },
});

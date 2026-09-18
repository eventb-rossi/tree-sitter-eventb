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
// - Identifiers use Rodin's alphabet (Java's identifier classes over Unicode,
//   see `IDENT_START`), so the letter glyphs ℕ, ℤ and ℙ are identifier
//   characters too: the bare glyph is the keyword, `ℤx` is one identifier,
//   exactly as Rodin's lexer reads the longest identifier and then looks the
//   whole image up in its token table.
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
 * One precedence level of the binary operator table, as a `binary_expression`
 * node. `left` and `right` are the levels the operands may reach: the level
 * itself on the left and the next tighter one on the right for a level that
 * folds left, and the next tighter one on both sides for a level the spec
 * declares non-associative, which is what refuses a chain of it.
 *
 * The precedences are not what orders the levels any more, the operand rules
 * are; they stay because the quantified forms, unary minus and the postfix
 * operators still resolve against a binary operator by precedence.
 */
function binaryLevel(level, left, right, operators) {
  return choice(
    ...operators.map((operator) =>
      prec.left(
        level,
        seq(
          field('left', left),
          field('operator', operator),
          field('right', right),
        ),
      ),
    ),
  );
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
// The levels the spec declares non-associative (the relation arrows and ⦂,
// the interval, the exponent) take at most one operator, because their
// operands are the next tighter level on both sides: `A ↔ B ↔ C`,
// `1 ‥ 2 ‥ 3` and `2 ^ 3 ^ 4` have no parse. That is grammar.pest's ladder,
// where `relation_type_expr`, `relational_expr` and `exponent_expr` each
// spell the operator `(… )?`, and it is Rodin's answer too: a chain is
// allowed only for a pair in `BMath.addOperatorRelationships()`, `^` and `‥`
// appear in none of those calls, and `BMathV2` drops the arrow
// self-compatibilities `BMathV1` had. The set operator compatibility matrix
// (Table 3.2) stays a semantic check: it is asymmetric (`∩ ▷` is accepted,
// `▷ ∩` is not) and so does not reduce to a precedence ladder.
// Unary minus parses at the additive level
// (kernel_lang §3.3.4 ⟨arithmetic-expr⟩ ::= ['-'] ⟨term⟩ …), matching
// rossi's grammar.pest: the sign takes a whole multiplicative or
// exponent term (`-a*b` is `-(a*b)`) while an additive continuation stays
// outside (`-a+b` keeps `(-a)+b`). After `^` it binds tightly instead, or
// the term it took would re-enter the exponent level and carry a second `^`
// past the check above; see `_exponent_operand`.
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

// Rodin's identifier alphabet (rossi's grammar.pest `ident_start` and
// `word_char`, names.rs `is_math_identifier_start/part`): Java's
// isJavaIdentifierStart/Part classes minus `λ` (the lambda token) and `$`
// (Rodin's meta-variable sigil). Letters, letter numbers, currency symbols
// and connector punctuation start a name; decimal digits and combining marks
// continue one. The general categories are disjoint, so rossi's fast-path
// guard against math symbols has no counterpart here. Rust regex syntax
// (`\p{..}` classes, class intersection `&&`), hence `RustRegex` rather than
// a JS literal, which the generator would read with JS escapes.
const IDENT_START = '[[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}]&&[^λ$]]';
const WORD_CHAR =
  '[[\\p{L}\\p{Nl}\\p{Sc}\\p{Pc}\\p{Nd}\\p{Mn}\\p{Mc}]&&[^λ$]]';
// Mathematical identifier (kernel_lang §2.2): an optional single trailing
// prime marks an Event-B after-state variable (`x'`); the prime never
// repeats nor appears interior (`x''`, `x'y` are two tokens), matching
// Rodin's lexer.
const IDENTIFIER = new RustRegex(`${IDENT_START}${WORD_CHAR}*'?`);
// The hyphen-joined tail segments of a component name (grammar.pest
// `component_name`: `ident_core ("-" word_char+)*`).
const COMPONENT_NAME_TAIL = new RustRegex(`-${WORD_CHAR}+`);

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

  // The kernel_lang §2.2 reserved words, which can never be an identifier —
  // not bare in a formula and not as a declared name. Keyword extraction
  // alone covers only the first half: where the word's own token is not
  // valid, it would otherwise fall back to `identifier`, and `variables card`
  // would parse. Rodin's `isValidIdentifierName` refuses exactly these
  // spellings, exact case (`Dom`, `CARD`, `Union` are ordinary identifiers),
  // and rossi's `is_reserved_word` mirrors it.
  //
  // `union` and `inter` are §2.2 words that this list leaves out on purpose:
  // they name the generalized set operators, which neither this grammar nor
  // rossi models, so reserving them would reject `union(S)`, which is
  // Event-B. rossi's ASCII operator spellings (`circ`, `not`, `oftype`,
  // `or`, `POW`, `POW1`) are absent for the opposite reason: they are this
  // dialect's own extension and Rodin reads them as identifiers.
  // A reserved word must name a token, so the words that share one token
  // (`builtin` is id/pred/prj1/prj2/succ, `_closed_predicate` is
  // finite/partition) are listed by their rule. The letter glyphs of the
  // number sets and the powerset are identifier characters (`IDENT_START`),
  // so the bare glyph would otherwise fall back to an identifier where its
  // token is not valid (`variables ℤ`); Rodin refuses those names too.
  reserved: {
    global: ($) => [
      'bool',
      'card',
      'dom',
      'max',
      'min',
      'mod',
      'ran',
      'ℤ',
      'ℕ',
      'ℕ1',
      'ℙ',
      'ℙ1',
      $.builtin,
      $._closed_predicate,
      $.bool_set,
      $.bool_true,
      $.bool_false,
    ],

    // Nothing is reserved in a component or event name. Those are Rodin file
    // names and labels, which `isValidIdentifierName` never sees: the model
    // corpus has a context named `partition` that machines `sees`, and rossi
    // accepts it too, checking `is_reserved_word` only where a *mathematical*
    // identifier is being named.
    structural_name: (_) => [],
  },

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
    [$.typed_identifier, $._closed_expression],
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
    _component_name: ($) =>
      reserved('structural_name', choice($.identifier, $.component_name)),

    component_name: ($) =>
      seq($.identifier, repeat1(token.immediate(COMPONENT_NAME_TAIL))),

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

    // The top of the operator ladder below: the maplet level, or anything
    // that binds tighter. It has to reach the bottom of the ladder by that
    // one path, or a reduction to it and a reduction to a level in between
    // would be indistinguishable.
    _expression: ($) => choice($.binary_expression, $._arrow_expr),

    // The bottom of the ladder below: a prefix operator, or a form whose own
    // delimiters close it. Only `unary_expression` reaches back up the ladder,
    // through the multiplicative term its minus sign takes, which is why the
    // exponent operand names the two halves separately.
    _simple_expression: ($) => choice($.unary_expression, $._closed_expression),

    _closed_expression: ($) =>
      choice(
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

    // `not` is one of rossi's ASCII operator spellings, not a word of the
    // kernel language: Rodin is Unicode-only there (`¬`) and accepts `not` as
    // an ordinary identifier, so rossi's `ASCII_OPERATOR_WORDS` leaves it
    // usable as a name and this fallback keeps it parsing as one. GLR holds
    // both readings until the continuation decides; the dynamic precedence on
    // `not_predicate` prefers the operator on ties, matching pest's
    // alternative order. The uppercase operators (POW, UNION, …) and the
    // keyword-free `if`/`union`/`inter`/`pow` need no fallback: their
    // identifier spellings differ from the exact operator spelling.
    _identifier_like: ($) => alias('not', $.identifier),

    // The binary operators form grammar.pest's ladder: each `_binary_*` rule
    // names the levels its operands may reach, and each `_*_expr` rule is
    // "this level or anything tighter". A level that folds left takes itself
    // on the left and the next tighter level on the right; a non-associative
    // level takes the next tighter level on both sides, so it cannot chain.
    // Every level surfaces as one `binary_expression` node.
    //
    // Variant spellings alias to the canonical operator, so consumers and
    // queries see a single spelling. U+E100-E103 are the Rodin private-use
    // code points for the relation-set arrows and relational override; the
    // first three have no real Unicode equivalent, so their ASCII spellings
    // are the canonical ones.

    // The loosest level, the pair constructor (maplet), carries the node name
    // every level surfaces as; it is left-associative, and `,,` is an
    // accepted input spelling for ↦.
    binary_expression: ($) =>
      binaryLevel(EXPR.maplet, $._expression, $._arrow_expr, [
        op('↦', '|->', ',,'),
      ]),

    // Set-of-relations constructors (and rossi's ⦂ type ascription),
    // tighter than the maplet, looser than the binary set operators, and
    // non-associative: `a ↦ b ↔ c` is `a ↦ (b ↔ c)`, `a ↔ b ↔ c` is nothing.
    _arrow_expr: ($) =>
      choice(alias($._binary_arrow, $.binary_expression), $._setop_expr),

    _binary_arrow: ($) =>
      binaryLevel(EXPR.arrow, $._setop_expr, $._setop_expr, [
        op('↔', '<->'),
        op('<<->', ''),
        op('<->>', ''),
        op('<<->>', ''),
        op('⇸', '+->'),
        op('→', '-->'),
        op('⤔', '>+>'),
        op('↣', '>->'),
        op('⤀', '+>>', '+->>'),
        op('↠', '->>', '-->>'),
        op('⤖', '>->>'),
        op('⦂', 'oftype'),
      ]),

    // Binary set operators. These do chain; which pairs may is Table 3.2, an
    // asymmetric relation left to semantic tooling.
    _setop_expr: ($) =>
      choice(alias($._binary_setop, $.binary_expression), $._interval_expr),

    _binary_setop: ($) =>
      binaryLevel(EXPR.setop, $._setop_expr, $._interval_expr, [
        op('∪', '\\/'),
        op('∩', '/\\'),
        op('∖', '\\'),
        op('×', '**'),
        ';',
        op('∘', 'circ'),
        op('<+', ''),
        op('◁', '<|'),
        op('⩤', '<<|'),
        op('▷', '|>'),
        op('⩥', '|>>'),
        op('⊗', '><'),
        op('∥', '||'),
      ]),

    // Interval constructor, non-associative: the spec (p.19) calls
    // `a ‥ b ‥ c` nonsensical and parses `‥` as taking one operator.
    _interval_expr: ($) =>
      choice(alias($._binary_interval, $.binary_expression), $._additive_expr),

    _binary_interval: ($) =>
      binaryLevel(EXPR.interval, $._additive_expr, $._additive_expr, [
        op('‥', '..'),
      ]),

    // Arithmetic. Both levels fold left.
    _additive_expr: ($) =>
      choice(
        alias($._binary_additive, $.binary_expression),
        $._multiplicative_expr,
      ),

    _binary_additive: ($) =>
      binaryLevel(EXPR.additive, $._additive_expr, $._multiplicative_expr, [
        '+',
        op('−', '-'),
      ]),

    _multiplicative_expr: ($) =>
      choice(
        alias($._binary_multiplicative, $.binary_expression),
        $._exponent_expr,
      ),

    _binary_multiplicative: ($) =>
      binaryLevel(
        EXPR.multiplicative,
        $._multiplicative_expr,
        $._exponent_expr,
        [op('∗', '*'), op('÷', '/'), 'mod'],
      ),

    // Exponent, non-associative and the tightest binary level. Its left
    // operand is a whole unary term and its right is `_exponent_operand`,
    // exactly as grammar.pest spells `exponent_expr`.
    _exponent_expr: ($) =>
      choice(
        alias($._binary_exponent, $.binary_expression),
        $._simple_expression,
      ),

    _binary_exponent: ($) =>
      binaryLevel(EXPR.exponent, $._simple_expression, $._exponent_operand, [
        '^',
      ]),

    // grammar.pest's `exponent_operand`. A minus after `^` binds tightly:
    // letting it take a whole multiplicative term would re-enter the exponent
    // level and smuggle a second `^` past the non-associativity above
    // (`2^−3^4`), which rossi and Rodin both refuse. Binding it tightly also
    // makes `2^−3∗4` the `(2^(−3))∗4` that rossi reads.
    _exponent_operand: ($) =>
      choice(
        alias($._tight_negation, $.unary_expression),
        alias($._powerset, $.unary_expression),
        $._closed_expression,
      ),

    _tight_negation: ($) =>
      prec.left(
        EXPR.additive,
        seq(
          field('operator', op('−', '-')),
          field('operand', $._exponent_operand),
        ),
      ),

    // Prefix unary operators: unary minus and the powersets ℙ/ℙ1 (POW/POW1).
    // Unary minus sits at additive precedence with left resolution, so a
    // tighter operator shifts into its operand (`-a*b` is `-(a*b)`) while
    // an equal-precedence `+`/`-` reduces first (`-a+b` is `(-a)+b`); the
    // powersets keep the tight prefix level. The dynamic precedence prefers
    // the operator reading of pow/pow1 over an identifier application when
    // both complete, matching pest's alternative order.
    unary_expression: ($) => choice($._negation, $._powerset),

    _negation: ($) =>
      prec.left(
        EXPR.additive,
        seq(
          field('operator', op('−', '-')),
          field('operand', $._multiplicative_expr),
        ),
      ),

    _powerset: ($) =>
      prec(
        EXPR.unary,
        prec.dynamic(
          1,
          seq(
            field('operator', choice(
              op('ℙ1', 'POW1'),
              op('ℙ', 'POW'),
            )),
            field('operand', $._simple_expression),
          ),
        ),
      ),

    // Closed unary application, with mandatory parentheses (Rodin's
    // UnaryExpressionParser; kernel_lang §3.3.6 ⟨unary-op⟩ '(' E ')'). These
    // are Rodin's `CLOSED` operator group, whose `parseRight` opens with an
    // unconditional `acceptOpenParen()`, so the word is meaningless bare:
    // kernel_lang §3.3.3 calls them bounded, "always followed by a formula
    // enclosed within parenthesis". `union`/`inter` belong to the group too,
    // but neither this grammar nor rossi models the generalized set
    // operators, so their spellings stay ordinary identifiers here.
    // Sits at postfix precedence as a postfix head so it binds like Rodin:
    // dom(f)(x) = (dom(f))(x), dom(f)∼ = (dom(f))∼.
    closed_unary_expression: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('operator', choice('card', 'dom', 'max', 'min', 'ran')),
          '(',
          field('operand', $._expression),
          ')',
        ),
      ),

    // Postfix converse: r∼ (r~).
    inverse_expression: ($) =>
      prec.left(
        EXPR.postfix,
        seq(field('operand', $._postfix_head), op('∼', '~')),
      ),

    // Relational image: r[S].
    relational_image: ($) =>
      prec.left(
        EXPR.postfix,
        seq(
          field('relation', $._postfix_head),
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
    // participate via parentheses only. Shared by function application, the
    // override sugar, relational_image and inverse_expression, which all take
    // a head rather than a whole expression: `a ∪ b∼` is `a ∪ (b∼)`.
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
        field(
          'function',
          choice(
            $.identifier,
            $._identifier_like,
            alias($._closed_predicate, $.builtin),
          ),
        ),
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
    // kernel language; the Unicode forms are canonical. Each glyph and its
    // ASCII spelling is its own token: the glyph is a reserved word (below)
    // while the ASCII word may still name an identifier, as in rossi.
    integer_set: (_) => choice('ℤ', alias('INT', 'ℤ')),
    natural_set: (_) => choice('ℕ', alias('NAT', 'ℕ')),
    natural1_set: (_) => choice('ℕ1', alias('NAT1', 'ℕ1')),
    bool_set: ($) => token('BOOL'),
    empty_set: ($) => token(choice('∅', '{}')),
    // The generic atoms of kernel_lang §2.2: Rodin's `ATOMIC_EXPR` group,
    // whose parser consumes nothing after the word, so unlike the closed
    // operators these stand bare (`r = id`, `p = prj1 ⦂ T`).
    builtin: ($) => token(choice('id', 'pred', 'prj1', 'prj2', 'succ')),

    // The two closed predicate words. Like the closed unary operators they
    // mandate their parentheses (Rodin reaches them through `FiniteParser`
    // and `MultiplePredicateParser`, both of which call `acceptOpenParen()`),
    // so they are reachable only as a predicate-application head. Aliased to
    // `builtin` so they keep one highlight and one node name.
    _closed_predicate: ($) => token(choice('finite', 'partition')),

    // ==========================
    // Lexical tokens
    // ==========================

    // See `IDENTIFIER`: Rodin's alphabet, one optional trailing prime.
    identifier: (_) => IDENTIFIER,
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

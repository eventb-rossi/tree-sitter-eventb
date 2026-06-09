; Event-B syntax highlighting queries (tree-sitter).
;
; Hand-maintained alongside the structural grammar in grammar.js. Captures use
; the standard ecosystem names (@keyword, @operator, @constant.builtin,
; @function.builtin, @comment, @string, @number, @label, @variable,
; @punctuation.*).
;
; ASCII operator spellings are aliased to their canonical Unicode form in the
; grammar (e.g. `<=` parses as the anonymous token `≤`), so each operator
; needs only its Unicode spelling here.

[
  "context"
  "machine"
  "extends"
  "sets"
  "constants"
  "axioms"
  "theorems"
  "refines"
  "sees"
  "variables"
  "invariants"
  "theorem"
  "end"
  "if"
  "then"
  "else"
] @keyword

[
  "∀"
  "∃"
  "·"
  "¬"
  "∧"
  "∨"
  "⇒"
  "⇔"
  "="
  "≠"
  "≤"
  "≥"
  "<"
  ">"
  "∈"
  "∉"
  "⊂"
  "⊄"
  "⊆"
  "⊈"
  "⦂"
  "↦"
  "↔"
  "<<->"
  "<->>"
  "<<->>"
  "⇸"
  "→"
  "⤔"
  "↣"
  "⤀"
  "↠"
  "⤖"
  "∪"
  "∩"
  "∖"
  "×"
  ";"
  "∘"
  "⊕"
  "◁"
  "⩤"
  "▷"
  "⩥"
  "⊗"
  "∥"
  "‥"
  "+"
  "−"
  "∗"
  "÷"
  "mod"
  "^"
  "ℙ"
  "ℙ1"
  "dom"
  "ran"
  "∼"
  "λ"
  "⋃"
  "⋂"
  "∣"
] @operator

"bool" @function.builtin

[
  (true)
  (false)
  (integer_set)
  (natural_set)
  (natural1_set)
  (bool_set)
  (empty_set)
] @constant.builtin

(builtin) @function.builtin
(function_application
  function: (identifier) @function)

(context name: (identifier) @module)
(machine name: (identifier) @module)
(refines_clause target: (identifier) @module)
(set_declaration name: (identifier) @type)

(comment) @comment
(string) @string
(number) @number
(label) @label
(identifier) @variable

["(" ")" "[" "]" "{" "}"] @punctuation.bracket
"," @punctuation.delimiter

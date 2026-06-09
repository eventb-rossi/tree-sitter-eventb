; Event-B syntax highlighting queries (tree-sitter).
;
; Hand-maintained alongside the structural grammar in grammar.js. Captures use
; the standard ecosystem names (@keyword, @operator, @constant.builtin,
; @function.builtin, @comment, @string, @number, @label, @variable,
; @punctuation.*).

[
  "context"
  "machine"
  "extends"
  "sets"
  "constants"
  "refines"
  "sees"
  "variables"
  "end"
] @keyword

(context name: (identifier) @module)
(machine name: (identifier) @module)
(set_declaration name: (identifier) @type)

(comment) @comment
(identifier) @variable

["{" "}"] @punctuation.bracket
"," @punctuation.delimiter

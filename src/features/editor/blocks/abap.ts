import type { LanguageFn } from 'highlight.js'

const KEYWORDS = [
  'ABSTRACT', 'ADD', 'AND', 'APPEND', 'APPENDING', 'AS', 'ASCENDING', 'ASSIGN', 'ASSIGNING', 'AT', 'AUTHORITY-CHECK',
  'BEGIN', 'BETWEEN', 'BY', 'CALL', 'CASE', 'CATCH', 'CHANGING', 'CHECK', 'CLASS', 'CLASS-DATA', 'CLASS-METHODS', 'CLEANUP',
  'CLEAR', 'CLOSE', 'COLLECT', 'COMMIT', 'COMPUTE', 'CONCATENATE', 'CONDENSE', 'CONSTANTS', 'CONTINUE', 'CONVERT', 'CREATE',
  'DATA', 'DEFAULT', 'DEFINITION', 'DELETE', 'DESCENDING', 'DESCRIBE', 'DISTINCT', 'DIVIDE', 'DO', 'ELSE', 'ELSEIF', 'END',
  'ENDAT', 'ENDCASE', 'ENDCLASS', 'ENDDO', 'ENDFORM', 'ENDFUNCTION', 'ENDIF', 'ENDINTERFACE', 'ENDLOOP', 'ENDMETHOD',
  'ENDMODULE', 'ENDON', 'ENDSELECT', 'ENDTRY', 'ENDWHILE', 'EVENTS', 'EXCEPTIONS', 'EXIT', 'EXPORT', 'EXPORTING', 'FETCH',
  'FIELD-SYMBOLS', 'FINAL', 'FOR', 'FORM', 'FREE', 'FROM', 'FUNCTION', 'GET', 'GROUP', 'HAVING', 'IF', 'IMPLEMENTATION',
  'IMPORT', 'IMPORTING', 'IN', 'INCLUDE', 'INHERITING', 'INITIAL', 'INITIALIZATION', 'INNER', 'INSERT', 'INTERFACE',
  'INTERFACES', 'INTO', 'IS', 'JOIN', 'KEY', 'LEAVE', 'LEFT', 'LIKE', 'LOOP', 'MESSAGE', 'METHOD', 'METHODS', 'MODIFY',
  'MODULE', 'MOVE', 'MOVE-CORRESPONDING', 'MULTIPLY', 'NEW', 'NOT', 'OF', 'ON', 'OPEN', 'OR', 'ORDER', 'OUTER', 'PARAMETERS',
  'PERFORM', 'PRIVATE', 'PROTECTED', 'PUBLIC', 'RAISE', 'RAISING', 'RANGES', 'READ', 'RECEIVING', 'REF', 'REFRESH', 'REPLACE',
  'REPORT', 'RETURN', 'RETURNING', 'ROLLBACK', 'ROWS', 'SECTION', 'SELECT', 'SELECT-OPTIONS', 'SELECTION-SCREEN', 'SET',
  'SHIFT', 'SINGLE', 'SORT', 'SPLIT', 'START-OF-SELECTION', 'STATICS', 'SUBMIT', 'SUBTRACT', 'SUM', 'TABLE', 'TABLES', 'THEN',
  'TO', 'TRANSPORTING', 'TRY', 'TYPE', 'TYPES', 'UNASSIGN', 'UP', 'UPDATE', 'USING', 'VALUE', 'WHEN', 'WHERE', 'WHILE',
  'WITH', 'WRITE',
]

/** highlight.js language definition for ABAP (classic syntax plus Open SQL / inline declarations). */
export const abapLanguage: LanguageFn = () => ({
  name: 'ABAP',
  aliases: ['sap-abap'],
  case_insensitive: true,
  // $pattern lets hyphenated words (FIELD-SYMBOLS, sy-subrc) match as one keyword; typings omit it.
  keywords: {
    $pattern: /[A-Za-z_][\w-]*/,
    keyword: KEYWORDS,
    built_in: ['sy-subrc', 'sy-tabix', 'sy-index', 'sy-datum', 'sy-uzeit', 'sy-uname', 'sy-mandt', 'sy-langu', 'sy-repid', 'sy-dbcnt'],
    literal: ['abap_true', 'abap_false', 'abap_undefined', 'space'],
  } as unknown as Record<string, string[]>,
  contains: [
    { scope: 'comment', begin: /^\*/, end: /$/ },
    { scope: 'comment', begin: /"/, end: /$/ },
    { scope: 'string', begin: /'/, end: /'/, contains: [{ begin: /''/, relevance: 0 }] },
    {
      scope: 'string',
      begin: /\|/,
      end: /\|/,
      contains: [{ scope: 'subst', begin: /\{/, end: /\}/ }],
    },
    { scope: 'string', begin: /`/, end: /`/ },
    { scope: 'number', begin: /\b\d+(?:\.\d+)?\b/, relevance: 0 },
  ],
})

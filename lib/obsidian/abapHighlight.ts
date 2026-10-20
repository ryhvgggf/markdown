/** ABAP（ECC 傳統語法與 Open SQL）語法高亮器，無額外 npm 相依套件。 */
import type { LanguageFn } from "highlight.js";

export const abapHighlight: LanguageFn = (hljs) => ({
  name: "ABAP",
  aliases: ["sap-abap"],
  case_insensitive: true,
  keywords: {
    keyword: [
      "ABAP ADD-TO-RETURN-TABLE APPEND ASSIGN ASSIGNING AT AUTHORITY-CHECK",
      "BACK BREAK CALL CASE CATCH CHECK CLASS CLEAR CLOSE COLLECT COMMIT COMPUTE",
      "CONCATENATE CONSTANTS CONTINUE CREATE DATA DELETE DESCRIBE DO ELSE ELSEIF",
      "ENDCASE ENDCLASS ENDDO ENDFORM ENDFUNCTION ENDIF ENDLOOP ENDMETHOD",
      "ENDSELECT ENDTRY ENDWHILE EXIT EXPORT FETCH FIELD-SYMBOLS FORM FREE",
      "FUNCTION GET IF IMPORT INCLUDE INITIALIZATION INSERT INTO LEAVE LOOP",
      "MESSAGE METHOD MODIFY MOVE NEW OPEN PARAMETERS PERFORM PUBLIC PRIVATE",
      "PROTECTED RAISE READ RECEIVE REFRESH REPLACE REPORT RETURN ROLLBACK",
      "SELECT SET SHIFT SORT SPLIT START-OF-SELECTION STATIC SUBMIT SUM",
      "TABLES TRY TYPE TYPES UNASSIGN UPDATE VALUE WHEN WHERE WHILE WRITE",
      "USING CHANGING RETURNING RECEIVING RAISING EXCEPTIONS", 
    ].join(" "),
    built_in: [
      "sy-subrc sy-datum sy-uzeit sy-mandt sy-tabix sy-index sy-uname",
      "sy-batch sy-langu sy-repid sy-dbcnt sy-msgty sy-msgid sy-msgno",
      "SELECT-OPTIONS PARAMETERS LIKE LINE OF STRUCTURE OCCURS TABLE",
      "INNER JOIN LEFT OUTER JOIN ON ORDER BY GROUP BY HAVING DISTINCT",
      "UP TO ROWS INTO CORRESPONDING FIELDS FOR ALL ENTRIES",
    ].join(" "),
    literal: "abap_true abap_false abap_undefined space",
  },
  contains: [
    { scope: "comment", begin: /^\*/, end: /$/ },
    { scope: "comment", begin: /"/, end: /$/ },
    { scope: "string", begin: /'/, end: /'/, contains: [{ begin: /''/, relevance: 0 }] },
    { scope: "string", begin: /`/, end: /`/ },
    { scope: "number", begin: /\b\d+(?:\.\d+)?\b/, relevance: 0 },
    hljs.C_LINE_COMMENT_MODE,
  ],
});

"use client";

/**
 * 在既有 textarea MarkdownEditor 外增加 Notion 快捷輸入。
 * 不建立新編輯器、不變動資料庫；所有編輯交回同一個 onUpdateContent。
 */
import { useCallback, useEffect, useRef, useState, type ReactNode, type KeyboardEvent, type FormEvent, type MouseEvent } from "react";
import {
  type EditResult, type NumberStyle, lineStart, lineEnd, parseItem,
  replaceRange, renumberLists, indentSubtree, orderedMarker, numberStyleAt,
  convertToList, isInsideCode, depthOf, moveSubtree,
} from "@/lib/obsidian/notionEditing";

type Props = {
  content: string;
  noteId?: string;
  onUpdateContent: (content: string) => void;
  children: ReactNode;
};
type Selection = { start: number; end: number };
type Snapshot = { value: string; start: number; end: number };
type Slash = { origin: number; query: string; selected?: Selection };
type Command = { name: string; label: string; help: string; type: "block" | "inline" };
const COMMANDS: Command[] = [
  { name: "h1", label: "標題 1", help: "#", type: "block" },
  { name: "h2", label: "標題 2", help: "##", type: "block" },
  { name: "h3", label: "標題 3", help: "###", type: "block" },
  { name: "h4", label: "標題 4", help: "####", type: "block" },
  { name: "h5", label: "標題 5", help: "#####", type: "block" },
  { name: "h6", label: "標題 6", help: "######", type: "block" },
  { name: "bullet", label: "無序清單", help: "- 項目", type: "block" },
  { name: "number", label: "數字清單", help: "1. 2. 3.", type: "block" },
  { name: "alpha", label: "字母清單", help: "a. b. c.", type: "block" },
  { name: "roman", label: "羅馬清單", help: "i. ii. iii.", type: "block" },
  { name: "todo", label: "待辦事項", help: "- [ ]", type: "block" },
  { name: "quote", label: "引用", help: '" + 空白', type: "block" },
  { name: "toggle", label: "摺疊清單", help: "> + 空白", type: "block" },
  { name: "callout", label: "Obsidian Callout", help: "> [!note]", type: "block" },
  { name: "table", label: "表格", help: "Markdown Table", type: "block" },
  { name: "code", label: "程式碼", help: "```", type: "block" },
  { name: "mermaid", label: "Mermaid", help: "流程圖", type: "block" },
  { name: "math", label: "數學公式", help: "$$", type: "block" },
  { name: "link", label: "連結", help: "[文字](網址)", type: "inline" },
  { name: "wikilink", label: "雙向連結", help: "[[筆記]]", type: "inline" },
  { name: "strike", label: "刪除線", help: "~文字~", type: "inline" },
];

function quotedRange(text: string, caret: number): { from: number; to: number; indent: string } | null {
  const rows = text.split("\n");
  const row = text.slice(0, caret).split("\n").length - 1;
  let open = -1, depth = 0;
  for (let i = 0; i <= row; i++) {
    const trim = rows[i].trim();
    if (trim === ":::quote") { depth++; open = i; }
    else if (trim === ":::") { depth--; if (depth <= 0) { depth = 0; open = -1; } }
  }
  if (open < 0) return null;
  for (let i = row + 1; i < rows.length; i++) {
    if (rows[i].trim() === ":::quote") depth++;
    if (rows[i].trim() === ":::") {
      depth--;
      if (!depth) return { from: open, to: i, indent: /^\s*/.exec(rows[open])?.[0] || "" };
    }
  }
  return null;
}

function makeBlock(command: string, selected: string, indent: string): { body: string; cursor: number } {
  const text = selected.replace(/\r\n?/g, "\n");
  const pad = (value: string) => value.split("\n").map(x => indent + x).join("\n");
  let body = "", cursor = 0;
  if (/^h[1-6]$/.test(command)) {
    const title = `${"#".repeat(Number(command[1]))} `;
    body = pad(title + text.trim()); cursor = body.length;
  } else if (["bullet", "todo", "number", "alpha", "roman"].includes(command)) {
    const type = ({ bullet:"bullet", todo:"task", number:"decimal", alpha:"alpha", roman:"roman" } as const)[command as "bullet" | "todo" | "number" | "alpha" | "roman"];
    body = pad(convertToList(text || "項目", type)); cursor = body.length;
  } else if (command === "quote") {
    body = `${indent}:::quote\n${text ? pad(text) : indent}\n${indent}:::`;
    cursor = text ? body.indexOf(text.split("\n")[0]) : indent.length + ":::quote\n".length;
    if (text) cursor += text.length;
  } else if (command === "toggle") {
    body = `${indent}> 未命名摺疊清單\n${text ? text.split("\n").map(x => indent + "  " + x).join("\n") : indent + "  "}`;
    cursor = body.length;
  } else if (command === "callout") {
    body = `${indent}> [!note] 筆記\n${text ? text.split("\n").map(x => indent + "> " + x).join("\n") : indent + "> "}`;
    cursor = body.length;
  } else if (command === "table") {
    body = `${indent}| 欄位一 | 欄位二 |\n${indent}| --- | --- |\n${indent}| 內容 | 內容 |`;
    cursor = body.length;
  } else if (command === "code" || command === "mermaid") {
    body = `${indent}\`\`\`${command === "mermaid" ? "mermaid" : ""}\n${text ? pad(text) : indent}\n${indent}\`\`\``;
    cursor = text ? body.length - (indent.length + 4) : body.indexOf("\n") + 1 + indent.length;
  } else if (command === "math") {
    body = `${indent}$$\n${text ? pad(text) : indent}\n${indent}$$`;
    cursor = body.length - indent.length - 3;
  } else if (command === "strike") {
    body = `~${text || "文字"}~`; cursor = text ? body.length : 1;
  } else if (command === "wikilink") {
    body = `[[${text || "筆記"}]]`; cursor = text ? body.length : 2;
  } else {
    body = `[${text || "文字"}](https://)`; cursor = body.length - 1;
  }
  return { body, cursor };
}

export function NotionEditorController({ content, noteId, onUpdateContent, children }: Props) {
  const [slash, setSlash] = useState<Slash | null>(null);
  const [highlight, setHighlight] = useState(0);
  const undoRef = useRef<Snapshot[]>([]);
  const redoRef = useRef<Snapshot[]>([]);
  const lastEditRef = useRef({ at: 0, type: "" });
  const lastNoteId = useRef(noteId);
  const wrapperRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (lastNoteId.current !== noteId) {
      lastNoteId.current = noteId;
      undoRef.current = [];
      redoRef.current = [];
      setSlash(null);
    }
  }, [noteId]);

  const textarea = useCallback(() => wrapperRef.current?.querySelector<HTMLTextAreaElement>("textarea") || null, []);
  const remember = useCallback((start: number, end: number, category: string) => {
    const now = Date.now();
    if (category !== "typing" || lastEditRef.current.type !== "typing" || now - lastEditRef.current.at > 650) {
      undoRef.current.push({ value: content, start, end });
      if (undoRef.current.length > 160) undoRef.current.shift();
      redoRef.current = [];
    }
    lastEditRef.current = { at: now, type: category };
  }, [content]);
  const commit = useCallback((r: EditResult, start: number, end: number, category = "format") => {
    if (r.text === content) return;
    remember(start, end, category);
    onUpdateContent(r.text);
    // textarea 是受控元件，等待 React 更新後再恢復游標。
    window.setTimeout(() => {
      const el = textarea();
      if (!el) return;
      el.focus();
      el.setSelectionRange(Math.min(r.cursor, r.text.length), Math.min(r.selectEnd ?? r.cursor, r.text.length));
    }, 0);
  }, [content, remember, onUpdateContent, textarea]);

  function restore(which: "undo" | "redo") {
    const el = textarea();
    if (!el) return;
    const from = which === "undo" ? undoRef.current : redoRef.current;
    const to = which === "undo" ? redoRef.current : undoRef.current;
    const snapshot = from.pop();
    if (!snapshot) return;
    to.push({ value: content, start: el.selectionStart, end: el.selectionEnd });
    onUpdateContent(snapshot.value);
    window.setTimeout(() => {
      const current = textarea();
      current?.focus();
      current?.setSelectionRange(Math.min(snapshot.start,snapshot.value.length), Math.min(snapshot.end,snapshot.value.length));
    },0);
  }

  function run(command: string) {
    const el = textarea();
    if (!el) return;
    const source = content;
    const current = slash;
    if (!current) return;
    const from = current.selected?.start ?? current.origin;
    const to = current.selected?.end ?? el.selectionStart;
    const selected = current.selected ? source.slice(from, to) : "";
    const indent = (/^\s*/.exec(source.slice(lineStart(source, from), lineEnd(source, from)))?.[0] || "");
    const { body, cursor } = makeBlock(command, selected, indent);
    const inline = COMMANDS.find(x => x.name === command)?.type === "inline";
    const before = source.slice(lineStart(source, from), from);
    const after = source.slice(to, lineEnd(source, to));
    const prefix = inline ? "" : before.trim() ? "\n\n" : "";
    const suffix = inline ? "" : after.trim() ? "\n\n" : "";
    const replacement = prefix + body + suffix;
    const result = replaceRange(source, from, to, replacement, prefix.length + cursor);
    setSlash(null);
    commit(result, from, to);
  }

  const filtered = COMMANDS.filter(x => (x.name + " " + x.label).toLowerCase().includes((slash?.query || "").toLowerCase())).slice(0, 15);

  function handleBeforeInputCapture(event: FormEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    const input = event.nativeEvent as InputEvent;
    if (input.inputType === "insertText" || input.inputType === "insertFromPaste" || input.inputType === "deleteContentBackward" || input.inputType === "deleteContentForward") {
      remember(event.target.selectionStart, event.target.selectionEnd, input.inputType === "insertText" ? "typing" : "edit");
    }
  }

  function handleInputCapture(event: FormEvent<HTMLDivElement>) {
    if (!slash || slash.selected) return;
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    const el = event.target;
    const end = el.selectionStart;
    if (end < slash.origin + 1) { setSlash(null); return; }
    const typed = el.value.slice(slash.origin, end);
    if (!/^\/[\w-]*$/i.test(typed)) { setSlash(null); return; }
    setSlash({ ...slash, query: typed.slice(1) });
    setHighlight(0);
  }

  function handleKeyCapture(event: KeyboardEvent<HTMLDivElement>) {
    if (!(event.target instanceof HTMLTextAreaElement)) return;
    const el = event.target;
    if (event.nativeEvent.isComposing || event.key === "Process") return;
    const src = content;
    const caret = el.selectionStart;
    const end = el.selectionEnd;
    const mod = event.ctrlKey || event.metaKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && event.shiftKey && key === "x") {
      event.preventDefault(); event.stopPropagation();
      const selected = src.slice(caret, end);
      commit(replaceRange(src, caret, end, `~${selected || "文字"}~`, selected ? selected.length + 2 : 1), caret, end);
      return;
    }
    if (mod && !event.altKey && key === "z") {
      event.preventDefault(); event.stopPropagation();
      restore(event.shiftKey ? "redo" : "undo"); return;
    }
    if (mod && !event.altKey && (key === "y" || key === "z" && event.shiftKey)) {
      event.preventDefault(); event.stopPropagation(); restore("redo"); return;
    }
    if (slash) {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setSlash(null); return; }
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault(); event.stopPropagation();
        setHighlight(prev => (prev + (event.key === "ArrowDown" ? 1 : -1) + Math.max(filtered.length, 1)) % Math.max(filtered.length, 1)); return;
      }
      if (event.key === "Enter") {
        event.preventDefault(); event.stopPropagation();
        if (filtered[highlight]) run(filtered[highlight].name);
        return;
      }
      if (slash.selected) {
        if (/^[a-z\d-]$/i.test(event.key)) {
          event.preventDefault(); event.stopPropagation();
          setSlash({...slash, query:slash.query + event.key}); setHighlight(0); return;
        }
        if (event.key === "Backspace") {
          event.preventDefault(); event.stopPropagation();
          setSlash({...slash,query:slash.query.slice(0,-1)}); setHighlight(0);return;
        }
      }
    }
    if (event.key === "/" && !event.altKey && !mod && !isInsideCode(src, caret) && !slash) {
      const before = src.slice(lineStart(src, caret),caret);
      const preceding = before.slice(-1);
      const inUrl = /(?:https?:\/\/|www\.|[A-Z]:\\|\.\/|\.\.\/|\/[\w.-]+)$/i.test(before);
      // 一般段落可用，但必須位於明確字詞邊界；避免檔案路徑與 URL 中的 / 誤觸。
      if (!inUrl && (!preceding || /[\s([{（，,:：]/u.test(preceding))) {
        event.preventDefault(); event.stopPropagation();
        if (end !== caret) {
          setSlash({origin:caret,query:"",selected:{start:caret,end}});
        } else {
          commit(replaceRange(src,caret,end,"/"),caret,end,"typing");
          setSlash({origin:caret,query:""});
        }
        setHighlight(0);
        return;
      }
    }
    if (event.key === " " && caret === end && !event.altKey && !mod && !isInsideCode(src, caret)) {
      const from = lineStart(src,caret);
      const before = src.slice(from, caret);
      const m = /^(\s*)(\[\]|"|>|\*|\+|-)$/u.exec(before);
      if (m) {
        let replacement = before + " ";
        let newCursor: number | undefined;
        if (m[2] === "[]") replacement = m[1] + "- [ ] ";
        if (m[2] === '"') {
          replacement = `${m[1]}:::quote\n${m[1]}\n${m[1]}:::`;
          newCursor = `${m[1]}:::quote\n${m[1]}`.length;
        }
        if (m[2] === "*" || m[2] === "+") replacement = m[1] + "- ";
        event.preventDefault(); event.stopPropagation();
        commit(replaceRange(src,from,caret,replacement,newCursor ?? replacement.length),caret,end);
        return;
      }
    }
    if (event.altKey && !mod && (event.key === "ArrowUp" || event.key === "ArrowDown")) {
      const result = moveSubtree(src, caret, event.key === "ArrowUp" ? -1 : 1);
      if (result) {
        event.preventDefault(); event.stopPropagation();
        commit(result, caret, end);
        return;
      }
    }
    if (event.key === "Tab" && !mod && !event.altKey) {
      const r = indentSubtree(src,caret,event.shiftKey?-1:1);
      if (r) {event.preventDefault();event.stopPropagation();commit(r,caret,end);return;}
    }
    if ((event.key === "Backspace" || event.key === "Delete") && caret !== end && !mod && !event.altKey && src.slice(caret,end).includes("\n")) {
      event.preventDefault(); event.stopPropagation();
      const next = replaceRange(src,caret,end,"");
      next.text = renumberLists(next.text, Math.max(0,caret-1));
      commit(next,caret,end);
      return;
    }
    if (event.key === "Backspace" && caret === end && !mod && !event.altKey) {
      const from = lineStart(src,caret);
      const item = parseItem(src.slice(from,lineEnd(src,caret)));
      if (item && !item.body.trim() && caret <= from + item.indent.length + item.marker.length + (item.kind === "task" ? 5 : 1)) {
        event.preventDefault();event.stopPropagation();
        const rowEnd = lineEnd(src,caret);
        const replacement = item.indent.length ? item.indent.replace(/ {1,2}$/,'') + (item.kind === "task" ? "- [ ] " : item.kind === "bullet" ? "- " : orderedMarker(numberStyleAt(Math.max(0,depthOf(item.indent)-1)),1)+" ") : "";
        let r = replaceRange(src,from,rowEnd,replacement);
        r.text = renumberLists(r.text,r.cursor);
        commit(r,caret,end);return;
      }
    }
    if (event.key === "Enter" && !mod && !event.altKey && !event.shiftKey && caret === end) {
      const from = lineStart(src,caret);
      const till = lineEnd(src,caret);
      const line = src.slice(from,till);
      const before = src.slice(from,caret);
      const quote = quotedRange(src,caret);
      if (quote && before.trim() !== ":::quote" && before.trim() !== ":::") {
        event.preventDefault();event.stopPropagation();
        if (!before.trim() && !src.slice(caret,till).trim()) {
          // 引用內空白行 Enter：移除空白行，游標跳到結尾標記後。
          const lineRange = src.split("\n");
          const closingIndex = lineRange.slice(0,quote.to+1).join("\n").length;
          const removed = src.slice(0,from) + src.slice(till + (till < src.length ? 1 : 0));
          const nextAt = Math.max(from,closingIndex - (till - from + (till < src.length ? 1 : 0)));
          const out = replaceRange(removed,nextAt,nextAt,removed[nextAt] === "\n" ? "" : "\n");
          commit(out,caret,end);return;
        }
        commit(replaceRange(src,caret,caret,"\n"+quote.indent),caret,end);return;
      }
      const calloutLine = /^(\s*)> (.*)$/.exec(line);
      if (calloutLine && !/^\[![a-z]+\]/i.test(calloutLine[2])) {
        const all = src.split("\n");
        const rowNo = src.slice(0, caret).split("\n").length - 1;
        for (let j = rowNo - 1; j >= 0; j--) {
          if (/^\s*> \[![a-z]+\]/i.test(all[j])) {
            event.preventDefault(); event.stopPropagation();
            commit(replaceRange(src, caret, caret, `\n${calloutLine[1]}> `), caret, end);
            return;
          }
          if (!/^\s*> /.test(all[j])) break;
        }
      }
      const head = /^(\s*)> (?!\[![a-z]+\])(.+)$/i.exec(line);
      if (head) {
        event.preventDefault();event.stopPropagation();
        commit(replaceRange(src,caret,caret,"\n"+head[1]+"  "),caret,end);return;
      }
      const item = parseItem(line);
      if (item) {
        event.preventDefault();event.stopPropagation();
        if (!item.body.trim() && !src.slice(caret,till).trim()) {
          const r = replaceRange(src,from,till,item.indent);
          commit(r,caret,end);return;
        }
        const afterText = src.slice(caret,till);
        const base = item.indent.replace(/\t/g,"  ").length;
        let insertAt = till;
        // 若原項目下有子項目，新拆出項目必須插在整棵子樹後方。
        while (insertAt < src.length && src[insertAt] === "\n") {
          const nextStart = insertAt + 1;
          const nextEnd = lineEnd(src,nextStart);
          const nextLine = src.slice(nextStart,nextEnd);
          if (!nextLine.trim()) { insertAt=nextEnd; continue; }
          const ind = /^\s*/.exec(nextLine)?.[0].replace(/\t/g,"  ").length || 0;
          if (ind <= base) break;
          insertAt=nextEnd;
        }
        const left = before;
        const withoutTail = src.slice(0,from)+left+src.slice(till);
        const shifted = insertAt - afterText.length;
        const newMarker = item.kind === "task" ? "- [ ]" : item.kind === "bullet" ? "-" : item.marker;
        const newLine = `\n${item.indent}${newMarker} ${afterText}`;
        let r = replaceRange(withoutTail,shifted,shifted,newLine,`\n${item.indent}${newMarker} `.length);
        r.text = renumberLists(r.text,r.cursor);
        commit(r,caret,end);return;
      }
      // 在 Toggle 內的空白內文行按 Enter，退出 Toggle；一般內文繼續縮排。
      const indentMatch = /^( +)/.exec(line);
      if (indentMatch && indentMatch[1].length >= 2) {
        const lines = src.split("\n");
        const rowNumber = src.slice(0,caret).split("\n").length-1;
        let toggleIndent: string | null = null;
        for (let j=rowNumber-1;j>=0;j--) {
          const h=/^( *)> (?!\[!)(.*)$/.exec(lines[j]);
          if (h && h[1].length < indentMatch[1].length) {toggleIndent=h[1];break;}
          if (lines[j].trim() && !/^(\s{2,})/.test(lines[j])) break;
        }
        if (toggleIndent!==null) {
          event.preventDefault();event.stopPropagation();
          if (!line.trim()) commit(replaceRange(src,from,till,toggleIndent),caret,end);
          else commit(replaceRange(src,caret,caret,"\n"+indentMatch[1]),caret,end);
          return;
        }
      }
      // 停止舊 MarkdownEditor 的 Word 清單／blockquote Enter 處理；一般文字使用原生 Enter。
      event.stopPropagation();
    }
  }

  function handleToolbarCapture(event: MouseEvent<HTMLDivElement>) {
    const t = event.target;
    if (!(t instanceof Element)) return;
    const checkbox = t.closest<HTMLInputElement>("input.obsidian-task-checkbox[data-task-line]");
    if (checkbox) {
      event.preventDefault(); event.stopPropagation();
      const index = Number(checkbox.dataset.taskLine);
      const rows = content.split(/\r\n|\n|\r/);
      const task = /^([ \t]*(?:[-+*]|\d+\.|[A-Za-z]+\.)[ \t]+\[)([ xX])(\])/;
      if (!Number.isInteger(index) || index < 0 || index >= rows.length || !task.test(rows[index])) return;
      const nextLine = rows[index].replace(task, (_: string, before: string, checked: string, after: string) =>
        before + (checked.toLowerCase() === "x" ? " " : "x") + after
      );
      if (nextLine !== rows[index]) {
        remember(0,0,"checkbox");
        rows[index] = nextLine;
        onUpdateContent(rows.join(content.includes("\r\n") ? "\r\n" : "\n"));
      }
      return;
    }
    const button = t.closest<HTMLButtonElement>("button");
    if (!button) return;
    if (button.title.includes("刪除線") || button.title === "引用區塊") {
      event.preventDefault();event.stopPropagation();
      const el = textarea();if (!el)return;
      const selected = content.slice(el.selectionStart,el.selectionEnd);
      const cmd = button.title === "引用區塊" ? "quote" : "strike";
      const {body,cursor} = makeBlock(cmd,selected,"");
      commit(replaceRange(content,el.selectionStart,el.selectionEnd,body,cursor),el.selectionStart,el.selectionEnd);
    }
  }

  return (
    <div ref={wrapperRef} className="notion-edit-controller relative h-full min-h-0" onKeyDownCapture={handleKeyCapture} onBeforeInputCapture={handleBeforeInputCapture} onInputCapture={handleInputCapture} onClickCapture={handleToolbarCapture}>
      {children}
      {slash && (
        <div className="notion-slash-menu" role="listbox" aria-label="Markdown 快速指令">
          <div className="notion-slash-heading">/ 快速插入 {slash.query && <span>· {slash.query}</span>}</div>
          <div className="notion-slash-scroll">
            {filtered.length ? filtered.map((cmd,index)=>(
              <button type="button" key={cmd.name} role="option" aria-selected={highlight===index}
                className={`notion-slash-row ${highlight===index ? "is-selected" : ""}`}
                onMouseDown={(e: MouseEvent<HTMLButtonElement>)=>e.preventDefault()} onClick={()=>run(cmd.name)}>
                <span className="notion-slash-name">/{cmd.name}　{cmd.label}</span>
                <small>{cmd.help}</small>
              </button>
            )) : <div className="notion-slash-empty">沒有相符指令（Esc 關閉）</div>}
          </div>
          <div className="notion-slash-hint">↑↓ 選擇　Enter 插入　Esc 保留文字並關閉</div>
        </div>
      )}
    </div>
  );
}

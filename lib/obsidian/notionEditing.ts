/**
 * Notion 式 Markdown 編輯操作：純函式，單一清單模型。
 * 不接觸 IndexedDB；不改動沒有被操作的舊筆記。
 */
export type EditResult = { text: string; cursor: number; selectEnd?: number };
export type ListKind = "bullet" | "task" | "ordered";
export type NumberStyle = "decimal" | "alpha" | "roman";

type Item = { indent: string; marker: string; checked: string; body: string; kind: ListKind; style?: NumberStyle };
const ITEM = /^(\s*)([-+*]|\d+\.|[A-Za-z]+\.)(\s+)(\[([ xX])\]\s+)?(.*)$/;
const ROMAN = /^[ivxlcdm]+$/i;

export function parseItem(line: string): Item | null {
  const m = ITEM.exec(line);
  if (!m) return null;
  const marker = m[2];
  const kind: ListKind = m[4] ? "task" : /^[-+*]$/.test(marker) ? "bullet" : "ordered";
  const letters = marker.replace(/\.$/, "");
  const style: NumberStyle | undefined = kind === "ordered"
    ? (/^\d/.test(marker) ? "decimal" : ROMAN.test(letters) ? "roman" : "alpha") : undefined;
  return { indent: m[1], marker, checked: m[5] || " ", body: m[6], kind, style };
}
export function replaceRange(src: string, from: number, to: number, replacement: string, cursorAt = replacement.length): EditResult {
  return { text: src.slice(0, from) + replacement + src.slice(to), cursor: from + cursorAt };
}
export function lineStart(src: string, pos: number): number {
  return src.lastIndexOf("\n", Math.max(0, pos - 1)) + 1;
}
export function lineEnd(src: string, pos: number): number {
  const i = src.indexOf("\n", pos);
  return i < 0 ? src.length : i;
}
export function depthOf(indent: string): number {
  return Math.floor(indent.replace(/\t/g, "  ").length / 2);
}
export function numberStyleAt(depth: number): NumberStyle {
  return (["decimal", "alpha", "roman"] as const)[depth % 3];
}
export function roman(value: number): string {
  let n = value;
  let out = "";
  for (const [v, text] of [[1000,"m"],[900,"cm"],[500,"d"],[400,"cd"],[100,"c"],[90,"xc"],[50,"l"],[40,"xl"],[10,"x"],[9,"ix"],[5,"v"],[4,"iv"],[1,"i"]] as const) {
    while (n >= v) { out += text; n -= v; }
  }
  return out;
}
export function alpha(n: number): string {
  let out = "";
  while (n) { n--; out = String.fromCharCode(97 + n % 26) + out; n = Math.floor(n / 26); }
  return out;
}
export function orderedMarker(style: NumberStyle, n: number): string {
  return (style === "roman" ? roman(n) : style === "alpha" ? alpha(n) : String(n)) + ".";
}

/**
 * 對單一連續清單區域進行結構重編號。各父清單維持獨立計數，
 * 僅在使用者已進行編輯的範圍內呼叫；其他舊筆記原文原封不動。
 */
export function renumberLists(text: string, editAt: number): string {
  const lines = text.split("\n");
  let at = text.slice(0, editAt).split("\n").length - 1;
  at = Math.min(Math.max(at, 0), lines.length - 1);
  if (!parseItem(lines[at])) {
    if (at > 0 && parseItem(lines[at - 1])) at--;
    else if (at + 1 < lines.length && parseItem(lines[at + 1])) at++;
    else return text;
  }
  let first = at, last = at;
  while (first > 0 && (parseItem(lines[first-1]) || (!lines[first-1].trim() && first > 1 && parseItem(lines[first-2])))) first--;
  while (last + 1 < lines.length && (parseItem(lines[last+1]) || (!lines[last+1].trim() && last + 2 < lines.length && parseItem(lines[last+2])))) last++;

  type Frame = { indent: number; kind: ListKind; style: NumberStyle; count: number; lastLetters: string };
  const stack: Frame[] = [];
  for (let i = first; i <= last; i++) {
    const item = parseItem(lines[i]);
    if (!item) continue;
    const indent = item.indent.replace(/\t/g, "  ").length;
    while (stack.length && stack[stack.length - 1].indent > indent) stack.pop();
    if (stack.length && stack[stack.length - 1].indent === indent && stack[stack.length - 1].kind !== item.kind) {
      // 同縮排切換清單類型時，從新的清單重新開始。
      stack.pop();
    }
    let frame = stack[stack.length - 1];
    if (!frame || frame.indent !== indent) {
      let style = item.style || "decimal";
      // 單獨 i. 是羅馬數字；a..h..i 是同一字母清單。
      if (/^[a-z]\.$/i.test(item.marker) && !/^i\.$/i.test(item.marker)) style = "alpha";
      frame = { indent, kind: item.kind, style, count: 0, lastLetters: "" };
      stack.push(frame);
    }
    if (item.kind === "ordered") {
      frame.count++;
      const next = orderedMarker(frame.style, frame.count);
      lines[i] = `${item.indent}${next} ${item.body}`;
    } else if (item.kind === "task") {
      lines[i] = `${item.indent}- [${item.checked.toLowerCase()}] ${item.body}`;
    } else {
      lines[i] = `${item.indent}- ${item.body}`;
    }
  }
  return lines.join("\n");
}

/** 以整棵子樹為單位縮排，避免子項目被原父項目遺棄。 */
export function indentSubtree(src: string, caret: number, direction: 1 | -1): EditResult | null {
  const lines = src.split("\n");
  const index = src.slice(0, caret).split("\n").length - 1;
  const target = parseItem(lines[index]);
  if (!target || (direction < 0 && !target.indent.length)) return null;
  if (direction > 0) {
    // 只能縮入前一個同層父項目，不允許第一筆孤立清單平白增加層級。
    let prior = index - 1;
    while (prior >= 0 && !lines[prior].trim()) prior--;
    const previous = prior >= 0 ? parseItem(lines[prior]) : null;
    if (!previous || depthOf(previous.indent) > depthOf(target.indent)) return null;
  }
  const base = target.indent.replace(/\t/g, "  ").length;
  let last = index;
  while (last + 1 < lines.length) {
    const next = lines[last+1];
    if (!next.trim()) { last++; continue; }
    const nextIndent = /^(\s*)/.exec(next)?.[1].replace(/\t/g,"  ").length || 0;
    if (nextIndent <= base) break;
    last++;
  }
  for (let j = index; j <= last; j++) {
    if (!lines[j].trim()) continue;
    if (direction > 0) lines[j] = "  " + lines[j];
    else lines[j] = lines[j].replace(/^(?: {1,2}|\t)/, "");
  }
  // 任何被 Tab/Shift+Tab 移動的 Ordered 子樹均套用新層級編號。
  // 只有跨層級時切換外觀；同層新增／移動仍保留使用者手動樣式。
  for (let j = index; j <= last; j++) {
    const item = parseItem(lines[j]);
    if (item?.kind === "ordered") {
      const marker = orderedMarker(numberStyleAt(depthOf(item.indent)), 1);
      lines[j] = `${item.indent}${marker} ${item.body}`;
    }
  }
  const oldStart = lineStart(src, caret);
  const nextStart = lines.slice(0, index).join("\n").length + (index ? 1 : 0);
  const nextCaret = Math.max(nextStart, caret + (direction > 0 ? 2 : -2));
  const changed = renumberLists(lines.join("\n"), nextStart);
  return { text: changed, cursor: Math.min(nextCaret, changed.length) };
}

/** 把選取行轉成某一清單型別，沿用唯一 parseItem 實作。 */
export function convertToList(content: string, style: "bullet" | "task" | NumberStyle): string {
  let n = 0;
  return content.split("\n").map(line => {
    if (!line.trim()) return line;
    const old = parseItem(line);
    const indent = old?.indent || (/^\s*/.exec(line)?.[0] || "");
    const text = old?.body || line.trimStart();
    if (style === "bullet") return `${indent}- ${text}`;
    if (style === "task") return `${indent}- [ ] ${text}`;
    return `${indent}${orderedMarker(style, ++n)} ${text}`;
  }).join("\n");
}

/** 任何不是可編輯 Markdown 的環境（程式碼與行內 code）皆不觸發快捷輸入。 */
export function isInsideCode(src: string, caret: number): boolean {
  const earlier = src.slice(0, caret).split("\n");
  let fence: { char: string; len: number } | null = null;
  for (const line of earlier.slice(0,-1)) {
    const f = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (!f) continue;
    if (!fence) fence = { char: f[1][0], len: f[1].length };
    else if (fence.char === f[1][0] && f[1].length >= fence.len) fence = null;
  }
  if (fence) return true;
  const current = earlier[earlier.length-1];
  if (/^(?: {4}|\t)/.test(current) && !/^(?: {4}|\t)[-+*\d]/.test(current)) return true;
  const ticks = current.match(/(?<!\\)`/g)?.length || 0;
  return ticks % 2 === 1;
}

/** Alt+↑/↓ 移動同一父項目內的完整清單子樹。 */
export function moveSubtree(src: string, caret: number, direction: -1 | 1): EditResult | null {
  const rows = src.split("\n");
  const index = src.slice(0, caret).split("\n").length - 1;
  const base = parseItem(rows[index]);
  if (!base) return null;
  const indent = base.indent.replace(/\t/g, "  ").length;
  const extent = (from: number): number => {
    let i = from + 1;
    while (i < rows.length) {
      const t = rows[i];
      if (!t.trim()) { i++; continue; }
      const spaces = /^\s*/.exec(t)?.[0].replace(/\t/g,"  ").length || 0;
      if (spaces <= indent) break;
      i++;
    }
    return i;
  };
  const currentEnd = extent(index);
  if (direction === 1) {
    let next = currentEnd;
    while (next < rows.length && !rows[next].trim()) next++;
    const sibling = next < rows.length ? parseItem(rows[next]) : null;
    if (!sibling || sibling.indent.replace(/\t/g,"  ").length !== indent) return null;
    const nextEnd = extent(next);
    const result = [
      ...rows.slice(0,index), ...rows.slice(next,nextEnd), ...rows.slice(currentEnd,next),
      ...rows.slice(index,currentEnd), ...rows.slice(nextEnd),
    ].join("\n");
    const newAt = result.split("\n").slice(0,index+(nextEnd-next)).join("\n").length + 1;
    const text = renumberLists(result,newAt);
    return { text, cursor: Math.min(newAt+base.indent.length,text.length) };
  }
  let previous = index - 1;
  while (previous >= 0 && !rows[previous].trim()) previous--;
  while (previous >= 0) {
    const item = parseItem(rows[previous]);
    if (!item) return null;
    const spaces = item.indent.replace(/\t/g,"  ").length;
    if (spaces < indent) return null;
    if (spaces === indent) break;
    previous--;
  }
  if (previous < 0) return null;
  const result = [
    ...rows.slice(0,previous), ...rows.slice(index,currentEnd), ...rows.slice(previous,index), ...rows.slice(currentEnd),
  ].join("\n");
  const newAt = result.split("\n").slice(0,previous).join("\n").length + (previous ? 1 : 0);
  const text = renumberLists(result,newAt);
  return { text, cursor: Math.min(newAt+base.indent.length,text.length) };
}

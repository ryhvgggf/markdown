import { CODE_LANGUAGES } from '@/features/editor/blocks/code-languages'
import { HIGHLIGHT_COLORS, TEXT_COLORS } from '@/features/editor/marks/formatting'
import { SLASH_ITEMS } from '@/features/editor/menus/slash-items'
import { ACCENTS } from '@/core/preferences/accents'
import {
  a, b, callout, code, codeBlock, color, doc, h, hid, hl, hr, i, keys, li, media, noteLink, ol, p, quote, s, table, tag, task,
  tasks, u, ul, type Inline, type J,
} from './pm-json'

export const GUIDE_FOLDER = '功能導覽'
export const GUIDE_TAG = '功能導覽'

/** Order = order in the folder; the first one is opened after seeding. */
export const GUIDE_NOTES = [
  { key: 'welcome', title: '歡迎使用' },
  { key: 'editing', title: '編輯與格式' },
  { key: 'blocks', title: '區塊與 / 選單' },
  { key: 'links', title: '連結、標籤與反向連結' },
  { key: 'media', title: '圖片與附件' },
  { key: 'organize', title: '整理筆記' },
  { key: 'search', title: '搜尋與快速切換' },
  { key: 'appearance', title: '外觀設定' },
] as const

export type GuideKey = (typeof GUIDE_NOTES)[number]['key']

export interface GuideRefs {
  note(key: GuideKey): string
  /** Stable id of a named block inside a guide note (the same id is used for the block and for links to it). */
  block(note: GuideKey, name: string): string
  /** Attachment id of the demo image, or null when it could not be stored. */
  image: string | null
}

const link = (r: GuideRefs, key: GuideKey) => noteLink(r.note(key))
const blockLink = (r: GuideRefs, key: GuideKey, name: string) => noteLink(r.note(key), r.block(key, name))
const yellow = HIGHLIGHT_COLORS[0].value
const red = TEXT_COLORS[1].value

function welcome(r: GuideRefs): J {
  return doc(
    p('這裡是你的筆記本。「', b(GUIDE_FOLDER), '」資料夾裡的筆記會一一介紹每個功能，而且筆記本身就是範例——放心在這裡試著編輯。刪掉之後，可以在「設定 → 資料」按「加入功能導覽筆記」重新加入。 ', tag(GUIDE_TAG)),
    h(2, '資料存在哪裡'),
    callout('info', p(b('本機優先：'), '所有筆記只存在「這個瀏覽器」裡，不會上傳到任何伺服器。換瀏覽器、換電腦或清除網站資料就看不到了；多裝置同步會在之後的版本加入。')),
    p('打字時會自動儲存，不需要按「儲存」。'),
    h(2, '畫面配置'),
    ul(
      [b('工具列'), '：滑鼠移到視窗最左緣，會滑出「檔案、搜尋、標籤、設定」四個圖示；也可以按 ', keys('Ctrl+\\', '⌘\\'), ' 開關。設定裡可以改成固定顯示。'],
      [b('側欄'), '：左邊的卡片是資料夾與筆記，最下方是「垃圾桶」。'],
      [b('筆記卡片'), '：中間就是正在看的筆記，最上面一行是標題。'],
      [b('右側面板'), '：點筆記右上角的「大綱」或「反向連結」膠囊打開，按 × 或 ', code('Esc'), ' 收起。'],
      ['視窗較窄時側欄會自動收起，點工具列的「檔案」就會浮出來。'],
    ),
    h(2, '標題與內文'),
    p('在標題按 ', code('Enter'), ' 或 ', code('↓'), '，游標會跳到內文開頭；在內文第一行按 ', code('↑'), ' 回到標題。同一個知識庫裡，筆記標題不能重複。'),
    h(2, '導覽目錄'),
    ol(
      [link(r, 'editing'), '：打字、Markdown 快捷輸入、格式列與快捷鍵'],
      [link(r, 'blocks'), '：/ 選單的每個區塊、拖曳把手、清單、表格、程式碼'],
      [link(r, 'links'), '：[[ 筆記連結、區塊連結、#標籤、大綱與反向連結'],
      [link(r, 'media'), '：加入圖片與影片'],
      [link(r, 'organize'), '：資料夾、排序、改名與垃圾桶'],
      [link(r, 'search'), '：', keys('Ctrl+K', '⌘K'), ' 搜尋與快速切換'],
      [link(r, 'appearance'), '：背景、強調色、字級等設定'],
    ),
    h(2, '之後會有'),
    ul(
      '舊版資料匯入、Markdown 匯出與自動鏡像（第 2 階段）',
      '帳號、端對端加密與多裝置同步（第 3 階段）',
      '分享連結（第 4 階段）',
      '知識圖譜、離線安裝（PWA）、Mermaid 圖表、數學公式、區塊嵌入（第 5 階段）',
    ),
  )
}

function editing(r: GuideRefs): J {
  const md = (input: Inline, result: string): Inline[] => [input, result]
  return doc(
    p('直接打字就好。按 ', code('Enter'), ' 開新段落，', code('Shift+Enter'), ' 在同一段落裡換行。用中文輸入法組字時，', code('Enter'), ' 只會確認選字，不會換行或觸發任何功能。 ', tag(GUIDE_TAG)),
    hid(r.block('editing', 'markdown'), 2, 'Markdown 快捷輸入'),
    p('在空白段落的開頭輸入下列符號，再按空白鍵，就會變成對應的區塊：'),
    table(['輸入', '變成'], [
      md(code('# '), '標題 1'),
      md(code('## '), '標題 2'),
      md(code('### '), '標題 3'),
      md([code('- '), ' 或 ', code('* ')], '項目清單'),
      md(code('1. '), '編號清單'),
      md([code('[] '), ' 或 ', code('[x] ')], '待辦清單（[x] 是已完成）'),
      md(code('> '), '引用'),
      md([code('``` '), '，或 ', code('```abap '), ' 指定語言'], '程式碼區塊'),
      md(code('---'), '分隔線（第三個 - 打完就會變）'),
    ]),
    p('行內格式在打完結尾符號時套用：'),
    table(['輸入', '變成'], [
      md(code('**粗體**'), '粗體'),
      md([code('*斜體*'), ' 或 ', code('_斜體_')], '斜體'),
      md(code('~~刪除線~~'), '刪除線'),
      md(code('`程式碼`'), '行內程式碼'),
      md(code('==螢光=='), '螢光標記'),
    ]),
    p('貼上 Markdown 文字（例如從別的筆記軟體複製）也會自動轉成標題、清單等區塊。'),
    h(2, '選取文字時的格式列'),
    p('用滑鼠或 ', code('Shift+方向鍵'), ' 選取文字，上方會出現格式列：粗體、斜體、底線、刪除線、行內程式碼、連結、文字顏色、螢光標記、轉為…。試著選取下面這行：'),
    p(b('粗體'), '、', i('斜體'), '、', u('底線'), '、', s('刪除線'), '、', code('行內程式碼'), '、', color('紅色文字', red), '、', hl('黃色螢光', yellow), '、', a('外部連結', 'https://example.com')),
    ul(
      [b('連結'), '：貼上網址按 ', code('Enter'), ' 套用；欄位清空再按 ', code('Enter'), ' 會移除連結。只接受 http、https 與 mailto，沒寫開頭會自動補上 https://。打字輸入網址後按空白鍵也會自動變成連結。'],
      [b('文字顏色'), ' 與 ', b('螢光標記'), '：各有 6 種顏色，選「預設」清除。'],
      [b('轉為…'), '：把所在的段落改成標題、清單、待辦、引用、提示框或程式碼。'],
    ),
    hid(r.block('editing', 'shortcuts'), 2, '快捷鍵'),
    table(['功能', 'Windows', 'Mac'], [
      ['粗體', code('Ctrl+B'), code('⌘B')],
      ['斜體', code('Ctrl+I'), code('⌘I')],
      ['底線', code('Ctrl+U'), code('⌘U')],
      ['刪除線', code('Ctrl+Shift+S'), code('⌘⇧S')],
      ['行內程式碼', code('Ctrl+E'), code('⌘E')],
      ['螢光標記', code('Ctrl+Shift+H'), code('⌘⇧H')],
      ['標題 1／2／3', code('Ctrl+Alt+1／2／3'), code('⌘⌥1／2／3')],
      ['編號／項目／待辦清單', code('Ctrl+Shift+7／8／9'), code('⌘⇧7／8／9')],
      ['引用', code('Ctrl+Shift+B'), code('⌘⇧B')],
      ['程式碼區塊', code('Ctrl+Alt+C'), code('⌘⌥C')],
      ['復原', code('Ctrl+Z'), code('⌘Z')],
      ['重做', [code('Ctrl+Shift+Z'), ' 或 ', code('Ctrl+Y')], code('⌘⇧Z')],
      ['段落內換行', code('Shift+Enter'), code('⇧Enter')],
      ['清單縮排／取消縮排', [code('Tab'), '／', code('Shift+Tab')], [code('Tab'), '／', code('⇧Tab')]],
      ['清單項目上移／下移', code('Alt+Shift+↑／↓'), code('⌥⇧↑／↓')],
      ['快速切換', code('Ctrl+K'), code('⌘K')],
      ['開關工具列', code('Ctrl+\\'), code('⌘\\')],
    ]),
    callout('tip', p('格式列與 / 選單打開時，', code('↑'), ' ', code('↓'), ' ', code('Enter'), ' ', code('Esc'), ' 只會操作選單，不會移動游標。')),
  )
}

function blocks(r: GuideRefs): J {
  return doc(
    p('在空白行的開頭輸入 ', code('/'), ' 會打開區塊選單。接著打字可以篩選（中文、英文都行，例如 ', code('/表格'), '、', code('/table'), '），', code('↑'), ' ', code('↓'), ' 選擇、', code('Enter'), ' 插入、', code('Esc'), ' 關閉。 ', tag(GUIDE_TAG)),
    table(
      ['項目', '插入什麼', '也可以搜尋'],
      SLASH_ITEMS.map((it) => [it.label, it.hint, it.aliases.join('、')]),
    ),
    hid(r.block('blocks', 'grip'), 2, '拖曳把手'),
    p('滑鼠移到任何區塊的左邊，會出現 ⠿ 把手：'),
    ul(
      ['按住拖曳：把區塊移到別的位置。'],
      ['點一下：打開選單，有「轉換類型」「複製區塊連結」「刪除」。'],
    ),
    h(2, '清單'),
    p(code('Tab'), ' 縮排、', code('Shift+Tab'), ' 取消縮排；', code('Alt+Shift+↑／↓'), '（Mac：', code('⌥⇧↑／↓'), '）把項目連同子項目一起上下移動。編號清單每往內一層會自動換樣式：'),
    ol(
      li('第一層用 1. 2. 3.', ol(li('第二層用 a. b. c.', ol('第三層用 i. ii. iii.', '再往內又回到 1.')), 'b 項')),
      '第二項',
    ),
    ul(li('項目清單也能多層', ul('子項目', '另一個子項目')), '最外層第二項'),
    hid(r.block('blocks', 'tasks'), 3, '待辦清單'),
    p('點方塊就能勾選；勾選後文字會變淡。'),
    tasks(
      task(true, ['讀完 ', link(r, 'welcome')]),
      task(false, '試著用 / 插入一個表格'),
      task(false, ['用 ', code('[['), ' 連結到另一篇筆記'], tasks(task(false, '待辦也可以有子項目'))),
    ),
    h(3, '引用'),
    quote(p('引用適合放摘錄、會議中別人說的話，或想特別區隔的段落。')),
    h(3, '提示框'),
    callout('info', p('點左邊的圖示可以在「資訊 → 警告 → 提示」三種樣式間切換。提示框裡可以放任何區塊。')),
    callout('warning', p('警告樣式：提醒容易出錯的地方。')),
    callout('tip', p('提示樣式：小技巧。')),
    hid(r.block('blocks', 'code'), 3, '程式碼區塊'),
    p('右上角的選單可以選語言：', CODE_LANGUAGES.map((l) => l.label).join('、'), '；不選就是純文字。區塊裡按 ', code('Tab'), ' 會插入兩個空白。'),
    codeBlock('abap', "REPORT zdemo.\n\nDATA lv_total TYPE i VALUE 0.\n\nLOOP AT lt_items INTO DATA(ls_item).\n  lv_total = lv_total + ls_item-amount.\nENDLOOP.\n\nWRITE: / '合計：', lv_total."),
    codeBlock('typescript', "const notes = vault.listNotes()\nconsole.log(`共有 ${notes.length} 篇筆記`)"),
    h(3, '表格'),
    p(code('/表格'), ' 插入 3 × 3 的表格，第一列是標題列。'),
    ul(
      ['在儲存格裡按 ', code('Tab'), ' 移到下一格、', code('Shift+Tab'), ' 回到上一格；在最後一格按 ', code('Tab'), ' 會新增一列。'],
      ['游標在表格裡時，所在儲存格的右上角會出現 ', b('⋯'), '（表格操作），點開可以：上方插入列、下方插入列、左側插入欄、右側插入欄、刪除列、刪除欄、刪除表格。'],
      ['滑鼠移到欄與欄之間的邊線，出現色條後按住拖曳，就能調整欄寬。'],
    ),
    table(
      ['功能', '怎麼叫出來', '說明'],
      [
        ['/ 選單', code('/'), '插入區塊'],
        ['筆記連結', code('[['), '連到其他筆記'],
        ['標籤', [code('#名稱'), ' + 空白'], '分類與搜尋'],
      ],
      r.block('blocks', 'table'),
    ),
    h(3, '分隔線'),
    p('輸入 ', code('---'), ' 或用 ', code('/分隔線'), '：'),
    hr(),
    p('分隔線上下的內容就會清楚分開。'),
  )
}

function links(r: GuideRefs): J {
  return doc(
    p('筆記之間可以互相連結，連結會自動追蹤改名與刪除。 ', tag(GUIDE_TAG)),
    h(2, '筆記連結'),
    p('輸入 ', code('[['), ' 會出現筆記清單，繼續打字篩選，', code('↑'), ' ', code('↓'), ' 選擇、', code('Enter'), ' 插入。找不到時選「建立新筆記「…」」，會用打的文字建立一篇新筆記並連結過去（你會留在目前的筆記）。點連結就會打開那篇筆記。'),
    p('例如：', link(r, 'welcome'), '、', link(r, 'search'), '。'),
    hid(r.block('links', 'block-links'), 2, '區塊連結'),
    p('區塊連結會直接跳到另一篇筆記裡的某個段落、標題、清單項目、表格或程式碼，並短暫標亮它。建立方式有兩種：'),
    ol(
      ['在 ', code('[['), ' 後面打完整的筆記標題再加 ', code('#'), '，例如 ', code('[[編輯與格式#快捷'), '，清單就會改列出那篇筆記裡的區塊。'],
      ['滑鼠移到區塊左邊，點 ⠿ 把手 →「複製區塊連結」，再到任何筆記貼上（', keys('Ctrl+V', '⌘V'), '），會自動變成區塊連結。'],
    ),
    p('這是指向表格的區塊連結：', blockLink(r, 'blocks', 'table'), '；這是指向快捷鍵表的：', blockLink(r, 'editing', 'shortcuts'), '。'),
    h(2, '三種連結顏色'),
    ul(
      [b('筆記連結'), '是藍色：', link(r, 'organize')],
      [b('區塊連結'), '是紫色：', blockLink(r, 'blocks', 'code')],
      [b('外部連結'), '（網址、Email）是青色，後面帶 ↗：', a('example.com', 'https://example.com')],
      ['連到已刪除筆記的連結會變成灰色並劃掉，點了不會有反應。'],
    ),
    h(2, '標籤'),
    p('輸入 ', code('#'), ' 加名稱再按空白鍵，例如 ', tag(GUIDE_TAG), '，就會變成標籤（英文字母會轉成小寫）。'),
    p(b('點一下標籤'), '，就會打開搜尋並列出所有帶這個標籤的筆記。也可以按 ', keys('Ctrl+K', '⌘K'), ' 輸入 ', code('#功能導覽'), '，或點工具列的「標籤」圖示。'),
    h(2, '右側面板：大綱與反向連結'),
    p('點筆記右上角的膠囊打開：'),
    ul(
      [b('大綱'), '：列出這篇筆記的標題 1～3，點一下就跳過去。'],
      [b('反向連結 N'), '：N 是有幾篇筆記連到這裡。「已連結」卡片會顯示連結所在的句子，點卡片打開那篇筆記並標亮該處。'],
      [b('提到但未連結'), '：列出內文提到這篇標題、卻還沒建立連結的筆記，按「轉為連結」就會把那段文字變成連結。'],
    ),
    p('試試看：打開「搜尋與快速切換」這篇的反向連結——「整理筆記」只用文字提到它，所以會出現在「提到但未連結」。'),
    h(2, '改名不會斷連結'),
    p('連結記住的是筆記本身而不是標題，所以改了標題，所有連結都會自動顯示新名稱。'),
  )
}

function mediaNote(r: GuideRefs): J {
  return doc(
    p('圖片和影片會跟筆記一起存在這個瀏覽器裡。 ', tag(GUIDE_TAG)),
    h(2, '三種加入方式'),
    ul(
      [code('/圖片或影片'), '，從電腦選擇檔案（可一次選多個）'],
      ['直接貼上剪貼簿裡的圖片，例如截圖後按 ', keys('Ctrl+V', '⌘V')],
      ['把檔案從桌面或檔案總管拖進筆記'],
    ),
    h(2, '限制'),
    ul('只支援圖片與影片', '每個檔案最大 100 MB', '不支援 SVG 圖片，請改用 PNG、JPEG 或 GIF'),
    h(2, '調整大小'),
    p('點一下圖片選取它，拖曳右下角的小方塊就能調整寬度。下面就是一張範例圖片：'),
    ...(r.image ? [media(r.image, 'image', 288)] : [p(i('（範例圖片無法建立）'))]),
    callout('info', p('從網頁或 Office 複製「文字加圖片」時，會優先貼上文字；只想要圖片的話，可以直接拖入圖片檔。')),
  )
}

function organize(): J {
  return doc(
    p('左邊的側欄用資料夾整理筆記。 ', tag(GUIDE_TAG)),
    h(2, '新增與排序'),
    ul(
      [b('新增筆記'), '（側欄上方的 ＋）：在目前筆記所在的資料夾裡新增一篇。'],
      [b('新增資料夾'), '（＋ 旁邊的資料夾圖示）：建立資料夾後直接輸入名稱，按 ', code('Enter'), ' 確定。'],
      ['點資料夾可以展開或收合。'],
      ['拖曳筆記或資料夾可以調整順序；拖到資料夾上就會移進去。'],
    ),
    h(2, '更多操作'),
    p('在筆記或資料夾上按右鍵，或滑鼠移上去點右邊的「⋯」：'),
    ul('重新命名（選取後按 F2 也可以）', '新增筆記、新增子資料夾（資料夾才有）', '移到垃圾桶'),
    h(2, '標題不能重複'),
    p('同一個知識庫裡的筆記標題不能重複（不分大小寫、忽略前後空白）。重複時標題下方會顯示「已有同名筆記」，換個名字就好。'),
    h(2, '垃圾桶'),
    ul(
      ['側欄最下方的「垃圾桶」列出刪除的筆記與資料夾，可以「還原」或「永久刪除」（會再確認一次）。'],
      ['移到垃圾桶的資料夾，裡面的筆記也一起移過去。'],
      ['放進垃圾桶 30 天後會自動永久刪除，每一筆都會顯示還剩幾天。'],
    ),
    // Plain-text mention of another guide note (demonstrates 提到但未連結 on that note).
    p('想更快打開筆記？請看搜尋與快速切換。'),
  )
}

function search(r: GuideRefs): J {
  return doc(
    p('按 ', keys('Ctrl+K', '⌘K'), '，或點工具列的「搜尋」圖示，打開快速切換。 ', tag(GUIDE_TAG)),
    ul(
      ['還沒打字時，列出最近編輯的 8 篇筆記。'],
      ['打字會同時搜尋標題與內文（中文、英文都可以），結果右邊顯示所在資料夾或符合的內文。'],
      ['以 ', code('#'), ' 開頭只搜尋標籤，例如 ', code('#功能導覽'), '。工具列的「標籤」圖示會直接帶入 #。'],
      ['沒有同名的筆記時，清單最下面有「新增筆記「…」」，選它就會建立並打開。'],
      [code('↑'), ' ', code('↓'), ' 選擇、', code('Enter'), ' 打開、', code('Esc'), ' 關閉；用輸入法組字時，', code('Enter'), ' 只會確認選字。'],
    ),
    callout('tip', p('搜尋結果怪怪的？到「設定 → 資料」按「重建索引」。')),
    p('相關：', link(r, 'links'), ' 介紹的 #標籤也能在這裡搜尋。'),
  )
}

function appearance(): J {
  return doc(
    p('滑鼠移到視窗最左緣叫出工具列（或按 ', keys('Ctrl+\\', '⌘\\'), '），點最下面的「設定」（齒輪）。設定會立即套用並自動儲存。 ', tag(GUIDE_TAG)),
    table(['分頁', '可以調整'], [
      ['背景', '上傳圖片當背景（最大 20 MB）、模糊度、淡化程度、恢復預設'],
      ['色彩', ['強調色：', ACCENTS.map((x) => x.name).join('、')]],
      ['文字', '字級（小／標準／大）、行距（緊湊／標準／寬鬆）、編輯區寬度（窄／標準／寬）'],
      ['版面', '工具列（滑鼠移到左緣時顯示／固定顯示）、側欄寬度'],
      ['動態', '減少動態效果、減少透明度（跟隨系統／開啟／關閉）'],
      ['資料', '儲存空間狀態、重建索引、加入功能導覽筆記'],
    ]),
    p('側欄與右側面板的邊緣也可以直接用滑鼠拖曳，調整寬度。'),
  )
}

const BUILDERS: Record<GuideKey, (r: GuideRefs) => J> = {
  welcome, editing, blocks, links, media: mediaNote, organize, search, appearance,
}

export function guideDoc(key: GuideKey, refs: GuideRefs): J {
  return BUILDERS[key](refs)
}

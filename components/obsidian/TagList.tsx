"use client";

interface TagListProps {
  tagsWithCounts: { tag: string; count: number }[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export function TagList({ tagsWithCounts, selectedTag, onSelectTag }: TagListProps) {
  return (
    <div className="p-3 border-t border-slate-800 bg-slate-900/90 text-slate-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5 text-purple-400" viewBox="0 0 24 24" fill="currentColor">
            <path d="M21.41 11.58l-9-9C12.05 2.22 11.55 2 11 2H4c-1.1 0-2 .9-2 2v7c0 .55.22 1.05.59 1.42l9 9c.36.36.86.58 1.41.58.55 0 1.05-.22 1.41-.59l7-7c.37-.36.59-.86.59-1.41 0-.55-.23-1.06-.59-1.42zM5.5 7C4.67 7 4 6.33 4 5.5S4.67 4 5.5 4 7 4.67 7 5.5 6.33 7 5.5 7z" />
          </svg>
          標籤彙整
        </span>
        {selectedTag && (
          <button
            onClick={() => onSelectTag(null)}
            className="text-[11px] text-purple-400 hover:text-purple-200 cursor-pointer"
          >
            全部顯示
          </button>
        )}
      </div>

      {tagsWithCounts.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">內文輸入 #標籤 即自動收錄</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
          {tagsWithCounts.map(({ tag, count }) => {
            const isSelected = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => onSelectTag(isSelected ? null : tag)}
                className={`inline-flex items-center gap-1 rounded-md px-2 py-0.5 text-xs transition cursor-pointer ${
                  isSelected
                    ? "bg-purple-600 text-white font-medium shadow-sm"
                    : "bg-slate-800 text-slate-300 hover:bg-slate-700 hover:text-slate-100"
                }`}
              >
                <span>#{tag}</span>
                <span
                  className={`text-[10px] rounded-full px-1 py-0.2 ${
                    isSelected ? "bg-purple-700 text-purple-100" : "bg-slate-900/80 text-slate-400"
                  }`}
                >
                  {count}
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

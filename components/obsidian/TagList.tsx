"use client";

interface TagListProps {
  tagsWithCounts: { tag: string; count: number }[];
  selectedTag: string | null;
  onSelectTag: (tag: string | null) => void;
}

export function TagList({ tagsWithCounts, selectedTag, onSelectTag }: TagListProps) {
  return (
    <div className="p-3 border-t border-white/6 bg-[#121418] text-slate-300">
      <div className="flex items-center justify-between mb-2">
        <span className="text-[11px] font-medium tracking-wider uppercase text-slate-400 flex items-center gap-1.5">
          <span>標籤 (Tags)</span>
        </span>
        {selectedTag && (
          <button
            onClick={() => onSelectTag(null)}
            className="text-[10px] text-cyan-400 hover:text-cyan-300 transition-colors cursor-pointer"
          >
            清除篩選
          </button>
        )}
      </div>

      {tagsWithCounts.length === 0 ? (
        <p className="text-[11px] text-slate-500 italic">內文鍵入 #標籤 即自動匯錄</p>
      ) : (
        <div className="flex flex-wrap gap-1.5 max-h-36 overflow-y-auto">
          {tagsWithCounts.map(({ tag, count }) => {
            const isSelected = selectedTag === tag;
            return (
              <button
                key={tag}
                onClick={() => onSelectTag(isSelected ? null : tag)}
                className={`inline-flex items-center gap-1 rounded-[1.5px] px-2 py-0.5 text-[11px] font-mono transition-colors duration-150 cursor-pointer border ${
                  isSelected
                    ? "bg-[#881337] text-rose-200 border-[#9f1239] font-medium shadow-xs"
                    : "bg-white/[0.03] text-slate-300 border-white/[0.07] hover:bg-white/[0.06] hover:text-slate-100 hover:border-white/15"
                }`}
              >
                <span>#{tag}</span>
                <span
                  className={`text-[9px] rounded px-1 py-0.2 ${
                    isSelected ? "bg-black/30 text-rose-200" : "bg-black/20 text-slate-500"
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

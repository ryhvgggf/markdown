"use client";

interface TagListProps {
  tagsWithCounts: {
    tag: string;
    count: number;
  }[];

  selectedTag:
    | string
    | null;

  onSelectTag: (
    tag: string | null
  ) => void;
}

export function TagList({
  tagsWithCounts,
  selectedTag,
  onSelectTag,
}: TagListProps) {
  return (
    <div className="text-[#c9c6be]">
      <div className="ink-section-title">
        <span>
          標籤
        </span>

        <span className="ink-count">
          {tagsWithCounts.length}
        </span>

        {selectedTag && (
          <button
            type="button"
            onClick={() =>
              onSelectTag(null)
            }
            className="ml-auto text-[9px] font-sans text-[#718f8a] hover:text-[#b5c9c5]"
          >
            清除
          </button>
        )}
      </div>

      {tagsWithCounts.length ===
      0 ? (
        <p className="text-[11px] leading-relaxed text-[#666b67]">
          在筆記內容輸入
          {" "}
          #標籤
          {" "}
          即會自動建立。
        </p>
      ) : (
        <div className="flex max-h-40 flex-wrap gap-2 overflow-y-auto pr-1">
          {tagsWithCounts.map(
            ({
              tag,
              count,
            }) => {
              const isSelected =
                selectedTag ===
                tag;

              return (
                <button
                  key={tag}
                  type="button"
                  onClick={() =>
                    onSelectTag(
                      isSelected
                        ? null
                        : tag
                    )
                  }
                  className={`obsidian-tag-seal ${
                    isSelected
                      ? "obsidian-tag-seal-active"
                      : ""
                  }`}
                >
                  <span>
                    #{tag}
                  </span>

                  <span className="ml-1 opacity-50">
                    {
                      count
                    }
                  </span>
                </button>
              );
            }
          )}
        </div>
      )}
    </div>
  );
}

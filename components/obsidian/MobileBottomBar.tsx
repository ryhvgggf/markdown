"use client";

type MobileBottomBarProps = {
  activeView: "editor" | "graph";
  onOpenNotes: () => void;
  onCreateNote: () => void;
  onOpenGraph: () => void;
  onOpenRelations: () => void;
};

export function MobileBottomBar({
  activeView,
  onOpenNotes,
  onCreateNote,
  onOpenGraph,
  onOpenRelations,
}: MobileBottomBarProps) {
  return (
    <nav
      className="mobile-bottom-bar"
      aria-label="手機導覽"
    >
      <button
        type="button"
        className="mobile-bottom-button"
        onClick={onOpenNotes}
      >
        <span className="mobile-bottom-icon">
          ☰
        </span>

        <span>
          筆記
        </span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button mobile-create-button"
        onClick={onCreateNote}
      >
        <span className="mobile-bottom-icon">
          ＋
        </span>

        <span>
          新增
        </span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-button ${
          activeView === "graph"
            ? "mobile-bottom-active"
            : ""
        }`}
        onClick={onOpenGraph}
      >
        <span className="mobile-bottom-icon">
          ◎
        </span>

        <span>
          圖譜
        </span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button"
        onClick={onOpenRelations}
      >
        <span className="mobile-bottom-icon">
          ⌘
        </span>

        <span>
          關聯
        </span>
      </button>
    </nav>
  );
}

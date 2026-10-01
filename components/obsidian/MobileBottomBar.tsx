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
    <nav className="mobile-bottom-bar">
      <button
        type="button"
        className="mobile-bottom-button"
        onClick={onOpenNotes}
        aria-label="開啟筆記"
      >
        <span className="mobile-bottom-icon">☰</span>
        <span>筆記</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button mobile-create-button"
        onClick={onCreateNote}
        aria-label="新增筆記"
      >
        <span className="mobile-bottom-icon">＋</span>
        <span>新增</span>
      </button>

      <button
        type="button"
        className={`mobile-bottom-button ${
          activeView === "graph"
            ? "mobile-bottom-active"
            : ""
        }`}
        onClick={onOpenGraph}
        aria-label="開啟圖譜"
      >
        <span className="mobile-bottom-icon">◎</span>
        <span>圖譜</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button"
        onClick={onOpenRelations}
        aria-label="開啟關聯資訊"
      >
        <span className="mobile-bottom-icon">⌘</span>
        <span>關聯</span>
      </button>
    </nav>
  );
}

"use client";

type MobileBottomBarProps = {
  activeView: "editor" | "graph";
  onOpenNotes: () => void;
  onCreateNote: () => void;
  onOpenGraph: () => void;
  onOpenRelations: () => void;
};

function NotesIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mobile-bottom-svg"
    >
      <path
        d="M5 6.5h14M5 12h14M5 17.5h9"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mobile-bottom-svg"
    >
      <path
        d="M12 5v14M5 12h14"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.55"
        strokeLinecap="round"
      />
    </svg>
  );
}

function GraphIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mobile-bottom-svg"
    >
      <circle cx="6.5" cy="8" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="17.5" cy="6.5" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <circle cx="15.5" cy="17" r="2.2" fill="none" stroke="currentColor" strokeWidth="1.4" />
      <path
        d="M8.5 7.6l6.8-.8M7.9 9.6l6.2 5.5M17 8.6l-1.1 6.2"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.25"
        strokeLinecap="round"
      />
    </svg>
  );
}

function RelationsIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      aria-hidden="true"
      className="mobile-bottom-svg"
    >
      <path
        d="M9.2 7.4 7.7 5.9a3.2 3.2 0 0 0-4.5 4.5l3.1 3.1a3.2 3.2 0 0 0 4.5 0l1.1-1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
      <path
        d="m14.8 16.6 1.5 1.5a3.2 3.2 0 1 0 4.5-4.5l-3.1-3.1a3.2 3.2 0 0 0-4.5 0l-1.1 1.1"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.45"
        strokeLinecap="round"
      />
    </svg>
  );
}

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
        aria-label="開啟筆記庫"
      >
        <span className="mobile-bottom-icon">
          <NotesIcon />
        </span>
        <span>筆記</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button mobile-create-button"
        onClick={onCreateNote}
        aria-label="新增筆記"
      >
        <span className="mobile-bottom-icon mobile-create-icon">
          <PlusIcon />
        </span>
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
        aria-label="開啟知識圖譜"
      >
        <span className="mobile-bottom-icon">
          <GraphIcon />
        </span>
        <span>圖譜</span>
      </button>

      <button
        type="button"
        className="mobile-bottom-button"
        onClick={onOpenRelations}
        aria-label="開啟關聯資訊"
      >
        <span className="mobile-bottom-icon">
          <RelationsIcon />
        </span>
        <span>關聯</span>
      </button>
    </nav>
  );
}

import { ChevronDown, ChevronLeft, ChevronRight, FolderPlus, Heart, ImageOff, ImagePlus, LoaderCircle, Trash2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { favoriteImageUrl, favoritePagination, parseFavoritePageInput, type Favorite } from "../lib/favorites";
import { parseTitle, type Settings } from "../lib/wallpaper";
import { WallpaperAutomation } from "./WallpaperAutomation";

interface Props {
  favorites: Favorite[];
  settings: Settings;
  loading: boolean;
  busy: boolean;
  settingsBusy: boolean;
  feedback: string;
  error: string;
  selectedId?: string;
  pendingId: string | null;
  onSelect: (favorite: Favorite, card: HTMLButtonElement) => void;
  onRemove: (favorite: Favorite) => void;
  onImport: (folder: boolean) => void;
  onSettings: (patch: Partial<Settings>) => void;
  onAdvance: () => void;
}

export function FavoritesGallery({ favorites, settings, loading, busy, settingsBusy, feedback, error, selectedId, pendingId, onSelect, onRemove, onImport, onSettings, onAdvance }: Props) {
  const [importOpen, setImportOpen] = useState(false);
  const [broken, setBroken] = useState<Set<string>>(() => new Set());
  const [requestedPage, setRequestedPage] = useState(1);
  const [pageInput, setPageInput] = useState<string | null>(null);
  const scrollArea = useRef<HTMLDivElement>(null);
  const importArea = useRef<HTMLDivElement>(null);
  const { page, totalPages, start, end } = favoritePagination(favorites.length, requestedPage);
  const visibleFavorites = favorites.slice(start, end);
  const pagingBusy = busy || Boolean(pendingId) || loading;

  useEffect(() => {
    // Removing the last item on a page must not leave an empty, nonexistent page.
    setRequestedPage(page);
    setPageInput(null);
    scrollArea.current?.scrollTo({ top: 0 });
  }, [page]);

  useEffect(() => {
    if (!importOpen) return;
    const dismiss = (event: PointerEvent) => {
      if (!importArea.current?.contains(event.target as Node)) setImportOpen(false);
    };
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setImportOpen(false); }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismissOnEscape, true);
    return () => { document.removeEventListener("pointerdown", dismiss); document.removeEventListener("keydown", dismissOnEscape, true); };
  }, [importOpen]);

  const goToPage = (next: number) => {
    setRequestedPage(favoritePagination(favorites.length, next).page);
    setPageInput(null);
  };
  const commitPageInput = () => goToPage(parseFavoritePageInput(pageInput ?? String(page), page, totalPages));
  return (
    <section className="month-gallery favorites-gallery" aria-label="我的收藏">
      <header className="month-gallery-heading">
        <div>
          <span className="month-gallery-kicker">{favorites.length} 张图片 · 本地收藏</span>
          <h2>我的收藏</h2>
        </div>
        <div className="favorites-header-actions">
          <WallpaperAutomation variant="header" settings={settings} favoriteCount={favorites.length} busy={settingsBusy || busy} onChange={onSettings} onAdvance={onAdvance} />
          <div ref={importArea} className="favorites-import">
            <button type="button" className="settings-action" disabled={busy} aria-expanded={importOpen} onClick={() => setImportOpen(!importOpen)}>
              {busy ? <LoaderCircle size={16} className="spin" /> : <ImagePlus size={16} />} {busy ? "处理中…" : "导入"}<ChevronDown size={14} />
            </button>
            {importOpen && (
              <div className="favorites-import-menu">
                <button type="button" onClick={() => { setImportOpen(false); onImport(false); }}><ImagePlus size={16} />选择图片</button>
                <button type="button" onClick={() => { setImportOpen(false); onImport(true); }}><FolderPlus size={16} />选择文件夹</button>
              </div>
            )}
          </div>
        </div>
      </header>
      {(error || feedback) && <p className={`favorites-feedback${error ? " error" : ""}`} role={error ? "alert" : "status"}>{error || feedback}</p>}
      <div ref={scrollArea} className="month-gallery-scroll favorites-scroll">
        {loading ? <div className="month-gallery-empty"><LoaderCircle className="spin" size={26} /><p>正在读取收藏…</p></div> : favorites.length ? (
          <div className="favorites-grid" key={page}>
            {visibleFavorites.map((favorite) => {
              const headline = parseTitle(favorite.title).headline;
              return (
                <div className="favorite-tile" key={favorite.id}>
                  <button type="button" className={`month-gallery-card${selectedId === favorite.id ? " selected" : ""}`} disabled={busy || Boolean(pendingId)} aria-label={`查看收藏：${headline}`} title={headline} onClick={(event) => onSelect(favorite, event.currentTarget)}>
                    <span className="month-gallery-image">
                      {!broken.has(favorite.id) ? <img src={favoriteImageUrl(favorite.thumbnailPath)} alt="" loading="lazy" decoding="async" onError={() => setBroken((current) => new Set([...current, favorite.id]))} /> : <ImageOff size={23} />}
                      <span className="favorite-caption">{favorite.source === "local" ? headline : favorite.date}</span>
                      {pendingId === favorite.id && <span className="month-gallery-card-loading"><LoaderCircle className="spin" size={19} /></span>}
                    </span>
                  </button>
                  <button type="button" className="favorite-remove" aria-label={`移除收藏：${headline}`} title="移除收藏（不会删除原文件）" disabled={busy || Boolean(pendingId)} onClick={() => onRemove(favorite)}><Trash2 size={14} /></button>
                </div>
              );
            })}
          </div>
        ) : (
          <div className="month-gallery-empty favorites-empty">
            <Heart size={32} /><h3>把喜欢的风景留在这里</h3>
            <p>在预览图上点心形收藏，或导入本地图片。</p>
            <small>导入的图片会复制保存。</small>
          </div>
        )}
      </div>
      {totalPages > 1 && !loading && (
        <footer className="favorites-pagination" aria-label="收藏分页">
          <span className="favorites-page-range">{start + 1}–{end} / {favorites.length} 张</span>
          <div className="favorites-page-controls">
            <button type="button" className="month-gallery-nav" aria-label="上一页收藏" disabled={pagingBusy || page === 1} onClick={() => goToPage(page - 1)}><ChevronLeft size={17} /></button>
            <label className="favorites-page-input">第<input type="text" inputMode="numeric" pattern="[0-9]*" maxLength={7} aria-label="收藏页码" value={pageInput ?? String(page)} disabled={pagingBusy} onChange={(event) => setPageInput(event.target.value.replace(/\D/g, ""))} onBlur={commitPageInput} onKeyDown={(event) => {
              if (event.key === "Enter") { event.preventDefault(); commitPageInput(); }
              if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); setPageInput(null); }
            }} onFocus={(event) => event.currentTarget.select()} /> / {totalPages} 页</label>
            <button type="button" className="month-gallery-nav" aria-label="下一页收藏" disabled={pagingBusy || page === totalPages} onClick={() => goToPage(page + 1)}><ChevronRight size={17} /></button>
          </div>
        </footer>
      )}
    </section>
  );
}

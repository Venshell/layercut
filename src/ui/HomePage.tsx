import { useEffect, useMemo, useRef, useState } from "react";
import { useI18n } from "../i18n";
import { useEditorStore } from "../layers/layerStore";
import { releaseAssetsExcept } from "../assets/assetStore";
import { loadProjectJson, openProjectFile, saveProjectAs } from "../project/saveProject";
import {
  clearAutosave,
  deleteRecent,
  listRecents,
  readAutosave,
  type AutosaveRecord,
  type RecentProject,
} from "../project/storage";
import { CanvasSetupForm } from "./CanvasSetupForm";
import { TextField } from "./controls";

function formatTime(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

// thumbnail + canvas-size extraction, cached per recent entry
const cardInfoCache = new Map<
  number,
  { thumb: string | null; canvasW: number; canvasH: number }
>();

function cardInfo(rec: RecentProject) {
  const cached = cardInfoCache.get(rec.id);
  if (cached) return cached;
  let info = { thumb: null as string | null, canvasW: 0, canvasH: 0 };
  try {
    const j = JSON.parse(rec.json);
    const first = Object.values(j.assets ?? {})[0] as { data?: string } | undefined;
    info = {
      thumb: first?.data ?? null,
      canvasW: j.canvas?.width ?? 0,
      canvasH: j.canvas?.height ?? 0,
    };
  } catch {
    /* corrupt entry */
  }
  cardInfoCache.set(rec.id, info);
  return info;
}

/**
 * Full-screen project console — the default view when the app launches,
 * like the home screen of design tools. Project management + create-new.
 */
export function HomePage({ onEnter }: { onEnter: () => void }) {
  const { t, lang, setLang } = useI18n();
  const [recents, setRecents] = useState<RecentProject[] | null>(null);
  const [recovery, setRecovery] = useState<AutosaveRecord | null>(null);
  const [name, setName] = useState("");
  const [width, setWidth] = useState("1080");
  const [height, setHeight] = useState("1920");
  const [background, setBackground] = useState<"transparent" | string>("transparent");
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void listRecents().then(setRecents);
    void readAutosave().then((rec) => {
      try {
        const layers = JSON.parse(rec?.json ?? "")?.layers;
        if (Array.isArray(layers) && layers.length > 0 && rec) setRecovery(rec);
      } catch {
        /* no/corrupt autosave */
      }
    });
  }, []);

  const create = () => {
    const w = Math.min(8192, Math.max(1, Math.round(Number(width) || 0)));
    const h = Math.min(8192, Math.max(1, Math.round(Number(height) || 0)));
    if (w <= 0 || h <= 0) return;
    const s = useEditorStore.getState();
    s.newCanvas({ width: w, height: h, background });
    // the replaced document is unreachable (history reset) — free its sources
    releaseAssetsExcept(new Set());
    s.setProjectName(name.trim());
    onEnter();
  };

  const open = async (rec: RecentProject) => {
    setBusy(true);
    try {
      await loadProjectJson(rec.json, rec.name);
      onEnter();
    } catch (e) {
      console.error(e);
      useEditorStore.getState().setNotice(`⚠ ${t("invalidProject")}`);
      setBusy(false);
    }
  };

  const restoreRecovery = async () => {
    if (!recovery) return;
    setBusy(true);
    try {
      await loadProjectJson(recovery.json, recovery.name);
      await clearAutosave();
      setRecovery(null);
      onEnter();
    } catch (e) {
      console.error(e);
      setBusy(false);
    }
  };

  const recoveryInfo = useMemo(() => {
    if (!recovery) return null;
    try {
      const j = JSON.parse(recovery.json);
      return { layers: j.layers?.length ?? 0 };
    } catch {
      return { layers: 0 };
    }
  }, [recovery]);

  const quickSave = async () => {
    setBusy(true);
    setSaveError(false);
    try {
      if (await saveProjectAs(useEditorStore.getState().projectName || "")) {
        setRecents(await listRecents());
      }
    } catch (error) {
      console.error(error);
      setSaveError(true);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="home">
      <header className="home-header">
        <div>
          <div className="home-brand">LayerCut</div>
          <div className="home-subtitle">{t("homeSubtitle")}</div>
        </div>
        <div className="home-header-actions">
          {useEditorStore.getState().layers.length > 0 && (
            <button className="btn" onClick={() => void quickSave()} disabled={busy}>
              {t("saveProject")}
            </button>
          )}
          <button className="btn" onClick={() => fileInputRef.current?.click()} disabled={busy}>
            {t("openProject")}
          </button>
          <button className="btn lang" onClick={() => setLang(lang === "zh" ? "en" : "zh")}>
            {lang === "zh" ? "EN" : "中"}
          </button>
        </div>
      </header>

      {saveError && <p className="dialog-note warn" role="alert">⚠ {t("saveFailed")}</p>}

      <main className="home-main">
        {recovery && recoveryInfo && (
          <div className="recovery-banner">
            <span>
              ⏻ {t("autosaveFoundPrefix")} · {formatTime(recovery.savedAt)}
              {recovery.name ? ` · ${recovery.name}` : ""} · {recoveryInfo.layers} ⬚
            </span>
            <span className="recovery-actions">
              <button
                className="btn small"
                onClick={async () => {
                  await clearAutosave();
                  setRecovery(null);
                }}
                disabled={busy}
              >
                {t("discard")}
              </button>
              <button className="btn small accent" onClick={() => void restoreRecovery()} disabled={busy}>
                {t("restore")}
              </button>
            </span>
          </div>
        )}

        <section className="home-box">
          <div className="home-section-title">{t("createNew")}</div>
          <TextField
            className="console-name"
            placeholder={t("projectName")}
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") create();
            }}
          />
          <CanvasSetupForm
            width={width}
            height={height}
            background={background}
            onChange={(next) => {
              if (next.width !== undefined) setWidth(next.width);
              if (next.height !== undefined) setHeight(next.height);
              if (next.background !== undefined) setBackground(next.background);
            }}
          />
          <p className="dialog-note">{t("noAutosaveNote")}</p>
          <div className="home-create-row">
            <button className="btn accent" onClick={create} disabled={busy}>
              {t("createProject")}
            </button>
          </div>
        </section>

        <section className="home-box">
          <div className="home-section-title">
            {t("recentProjects")}
            <button className="btn small" onClick={() => fileInputRef.current?.click()} disabled={busy}>
              {t("openFromDisk")}
            </button>
          </div>
          <input
            ref={fileInputRef}
            type="file"
            accept=".layercut,application/json"
            hidden
            onChange={async (e) => {
              const file = e.target.files?.[0];
              e.target.value = "";
              if (!file) return;
              try {
                await openProjectFile(file);
                onEnter();
              } catch (err) {
                console.error(err);
                useEditorStore.getState().setNotice(`⚠ ${t("invalidProject")}`);
              }
            }}
          />
          {recents !== null && recents.length === 0 && (
            <div className="muted small home-empty">{t("recentsEmpty")}</div>
          )}
          <div className="recent-grid">
            {recents?.map((rec) => {
              const info = cardInfo(rec);
              return (
                <div key={rec.id} className="recent-card" onClick={() => void open(rec)}>
                  <div className="recent-thumb">
                    {info.thumb ? (
                      <img src={info.thumb} alt="" draggable={false} />
                    ) : (
                      <span className="muted small">⬚</span>
                    )}
                  </div>
                  <div className="recent-card-body">
                    <span className="recent-name">{rec.name}</span>
                    <span className="recent-meta">
                      {info.canvasW > 0 ? `${info.canvasW} × ${info.canvasH}` : ""} ·{" "}
                      {formatTime(rec.savedAt)} · {rec.layerCount} ⬚
                    </span>
                  </div>
                  <button
                    className="icon-btn danger card-delete"
                    title="✕"
                    disabled={busy}
                    onClick={async (e) => {
                      e.stopPropagation();
                      await deleteRecent(rec.id);
                      setRecents(await listRecents());
                    }}
                  >
                    ✕
                  </button>
                </div>
              );
            })}
          </div>
        </section>
      </main>
    </div>
  );
}

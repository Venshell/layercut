import { useEffect, useState } from "react";
import { I18nProvider } from "./i18n";
import { useKeyboard } from "./editor/useKeyboard";
import { CanvasEditor } from "./editor/CanvasEditor";
import { Toolbar } from "./ui/Toolbar";
import { LayerPanel } from "./layers/LayerPanel";
import { useEditorStore } from "./layers/layerStore";
import { PropertiesPanel } from "./ui/PropertiesPanel";
import { StatusBar } from "./ui/StatusBar";
import { NewCanvasDialog } from "./ui/NewCanvasDialog";
import { ExportDialog } from "./ui/ExportDialog";
import { SaveDialog } from "./ui/SaveDialog";
import { HomePage } from "./ui/HomePage";
import { Divider } from "./ui/Divider";
import { useAutosave } from "./project/useAutosave";
import { useUIStore } from "./ui/uiStore";

type View = "home" | "editor";

function EditorShell({ onHome }: { onHome: () => void }) {
  useKeyboard();
  useAutosave();
  const [dialog, setDialog] = useState<null | "new" | "export" | "save">(null);
  const projectName = useEditorStore((s) => s.projectName);
  const isDirty = useEditorStore((s) => s.historyVersion !== s.savedVersion);
  const leftPanel = useUIStore((s) => s.leftPanel);
  const rightPanel = useUIStore((s) => s.rightPanel);

  // window title reflects project name + unsaved state
  useEffect(() => {
    document.title = `${isDirty ? "● " : ""}${projectName || "LayerCut"}${projectName ? " — LayerCut" : ""}`;
  }, [projectName, isDirty]);

  // Ctrl+S saves (never while a dialog is already open)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        if (useUIStore.getState().openDialogs === 0) setDialog("save");
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar
        onHome={onHome}
        onNewCanvas={() => setDialog("new")}
        onExport={() => setDialog("export")}
        onSave={() => setDialog("save")}
      />
      <div className="workspace">
        <LayerPanel width={leftPanel.width} collapsed={leftPanel.collapsed} />
        <Divider side="left" />
        <CanvasEditor />
        <Divider side="right" />
        <PropertiesPanel width={rightPanel.width} collapsed={rightPanel.collapsed} />
      </div>
      <StatusBar />
      {dialog === "new" && <NewCanvasDialog onClose={() => setDialog(null)} />}
      {dialog === "export" && <ExportDialog onClose={() => setDialog(null)} />}
      {dialog === "save" && <SaveDialog onClose={() => setDialog(null)} />}
    </div>
  );
}

export default function App() {
  const [view, setView] = useState<View>("home");
  return (
    <I18nProvider>
      {view === "home" ? (
        <HomePage onEnter={() => setView("editor")} />
      ) : (
        <EditorShell onHome={() => setView("home")} />
      )}
    </I18nProvider>
  );
}

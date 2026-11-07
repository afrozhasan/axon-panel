import { useEffect, useRef, useState, useCallback, useMemo } from "react";
import { api, errorMessage } from "../lib/api";
import { formatBytes, relativeTime, formatDate } from "../lib/format";
import {
  Badge,
  Button,
  Card,
  ConfirmDialog,
  EmptyState,
  ErrorBanner,
  Field,
  Modal,
  Spinner,
  useToast,
} from "../components/ui";

type Entry = {
  name: string;
  path: string;
  kind: "file" | "directory" | "symlink";
  symlink: boolean;
  size: number;
  modified: string | null;
  mode: string | null;
  owner?: string;
  group?: string;
  readable: boolean;
  ext?: string;
  isArchive?: boolean;
  isMedia?: boolean;
  mediaType?: "image" | "video" | "audio" | "pdf" | "archive" | "code" | "text" | "binary";
};

type Listing = {
  path: string;
  parent: string;
  entries: Entry[];
  stats?: { totalFiles: number; totalDirs: number; totalBytes: number };
  writable: boolean;
};

type Shortcut = {
  path: string;
  label: string;
  icon?: string;
};

function joinPath(base: string, name: string) {
  return base === "/" ? `/${name}` : `${base}/${name}`;
}

function getBasename(filePath: string): string {
  if (!filePath) return "";
  const parts = filePath.replace(/\/+$/, "").split("/");
  return parts.pop() || "";
}

function getDirname(filePath: string): string {
  if (!filePath || filePath === "/") return "/";
  const parts = filePath.replace(/\/+$/, "").split("/");
  parts.pop();
  return parts.join("/") || "/";
}

function FileTypeIcon({ entry }: { entry: Entry }) {
  if (entry.kind === "directory") {
    return (
      <svg className="h-4 w-4 shrink-0 text-amber-400" viewBox="0 0 24 24" fill="currentColor">
        <path d="M19.5 21a3 3 0 0 0 3-3v-4.5a3 3 0 0 0-3-3h-1.5V9a3 3 0 0 0-3-3h-3.379a3 3 0 0 1-2.121-.879L8.379 4.121A3 3 0 0 0 6.257 3.242H4.5A3 3 0 0 0 1.5 6.242v12.758a3 3 0 0 0 3 3h15Z" />
      </svg>
    );
  }

  if (entry.isArchive) {
    return (
      <svg className="h-4 w-4 shrink-0 text-purple-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <path d="M21 8v13H3V8M1 3h22v5H1zM10 12h4" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }

  const ext = (entry.ext || "").toLowerCase();

  if (ext === ".php") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-indigo-500/20 text-[9px] font-bold text-indigo-400 border border-indigo-500/30">
        P
      </span>
    );
  }

  if ([".js", ".mjs", ".cjs", ".ts", ".tsx", ".jsx"].includes(ext)) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-amber-500/20 text-[9px] font-bold text-amber-300 border border-amber-500/30">
        JS
      </span>
    );
  }

  if ([".css", ".scss", ".sass", ".less"].includes(ext)) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-sky-500/20 text-[9px] font-bold text-sky-400 border border-sky-500/30">
        #
      </span>
    );
  }

  if ([".html", ".htm"].includes(ext)) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-orange-500/20 text-[9px] font-bold text-orange-400 border border-orange-500/30">
        &lt;&gt;
      </span>
    );
  }

  if ([".json", ".yaml", ".yml", ".toml"].includes(ext)) {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-emerald-500/20 text-[9px] font-bold text-emerald-400 border border-emerald-500/30">
        {}
      </span>
    );
  }

  if ([".sql", ".db", ".sqlite"].includes(ext)) {
    return (
      <svg className="h-4 w-4 shrink-0 text-cyan-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <ellipse cx="12" cy="5" rx="9" ry="3" />
        <path d="M21 12c0 1.66-4 3-9 3s-9-1.34-9-3" />
        <path d="M3 5v14c0 1.66 4 3 9 3s9-1.34 9-3V5" />
      </svg>
    );
  }

  if (entry.mediaType === "image") {
    return (
      <svg className="h-4 w-4 shrink-0 text-pink-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
        <circle cx="8.5" cy="8.5" r="1.5" />
        <polyline points="21 15 16 10 5 21" />
      </svg>
    );
  }

  if (entry.mediaType === "video" || entry.mediaType === "audio") {
    return (
      <svg className="h-4 w-4 shrink-0 text-rose-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <polygon points="5 3 19 12 5 21 5 3" />
      </svg>
    );
  }

  if (entry.mediaType === "pdf") {
    return (
      <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded bg-red-500/20 text-[8px] font-bold text-red-400 border border-red-500/30">
        PDF
      </span>
    );
  }

  if (entry.name.startsWith(".") || [".env", ".htaccess", ".conf"].includes(ext)) {
    return (
      <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
        <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
        <path d="M7 11V7a5 5 0 0 1 10 0v4" />
      </svg>
    );
  }

  return (
    <svg className="h-4 w-4 shrink-0 text-slate-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
      <polyline points="14 2 14 8 20 8" />
    </svg>
  );
}

export default function Files() {
  const [listing, setListing] = useState<Listing | null>(null);
  const [shortcuts, setShortcuts] = useState<Shortcut[]>([]);
  const [pathInput, setPathInput] = useState("/var/www");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Settings & Filter
  const [showHidden, setShowHidden] = useState(true);
  const [searchQuery, setSearchQuery] = useState("");
  const [sortField, setSortField] = useState<"name" | "size" | "mode" | "modified">("name");
  const [sortOrder, setSortOrder] = useState<"asc" | "desc">("asc");

  // Selection
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());

  // Drag and Drop
  const [isDraggingOver, setIsDraggingOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Modals
  const [newFileModal, setNewFileModal] = useState(false);
  const [newFileName, setNewFileName] = useState("");

  const [newFolderModal, setNewFolderModal] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");

  const [renaming, setRenaming] = useState<Entry | null>(null);
  const [renameTo, setRenameTo] = useState("");

  const [deletingEntries, setDeletingEntries] = useState<Entry[] | null>(null);

  const [editor, setEditor] = useState<{
    path: string;
    content: string;
    originalContent: string;
    binary: boolean;
    size: number;
    mode: string;
    owner: string;
    ext: string;
  } | null>(null);

  const [previewMedia, setPreviewMedia] = useState<{
    path: string;
    name: string;
    mediaType: string;
    ext: string;
  } | null>(null);

  const [chmodModal, setChmodModal] = useState<{
    open: boolean;
    entries: Entry[];
    mode: string;
    recursive: boolean;
  }>({ open: false, entries: [], mode: "0644", recursive: false });

  const [chownModal, setChownModal] = useState<{
    open: boolean;
    entries: Entry[];
    user: string;
    group: string;
    recursive: boolean;
  }>({ open: false, entries: [], user: "www-data", group: "www-data", recursive: false });

  const [compressModal, setCompressModal] = useState<{
    open: boolean;
    entries: Entry[];
    archiveName: string;
    format: "zip" | "tar.gz";
  }>({ open: false, entries: [], archiveName: "", format: "zip" });

  const [extractModal, setExtractModal] = useState<{
    open: boolean;
    entry: Entry | null;
    destination: string;
  }>({ open: false, entry: null, destination: "" });

  const [copyMoveModal, setCopyMoveModal] = useState<{
    open: boolean;
    mode: "copy" | "move";
    entries: Entry[];
    destination: string;
  }>({ open: false, mode: "copy", entries: [], destination: "" });

  const toast = useToast();

  const browse = useCallback(
    async (target: string, keepSelected = false) => {
      setLoading(true);
      setError(null);
      if (!keepSelected) setSelectedPaths(new Set());
      try {
        const result = await api.get<Listing>(
          `/files/list?path=${encodeURIComponent(target)}&showHidden=${showHidden ? "1" : "0"}`
        );
        setListing(result);
        setPathInput(result.path);
      } catch (caught) {
        setError(errorMessage(caught));
      } finally {
        setLoading(false);
      }
    },
    [showHidden]
  );

  useEffect(() => {
    api
      .get<{ roots: { path: string; label: string }[]; shortcuts: Shortcut[] }>("/files/roots")
      .then((res) => {
        setShortcuts(res.shortcuts || res.roots || []);
      })
      .catch(() => {});
    browse("/var/www");
  }, [browse]);

  // Sorting and Filtering
  const displayedEntries = useMemo(() => {
    if (!listing) return [];
    let list = [...listing.entries];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      list = list.filter((e) => e.name.toLowerCase().includes(q));
    }

    list.sort((a, b) => {
      if (a.kind === "directory" && b.kind !== "directory") return -1;
      if (a.kind !== "directory" && b.kind === "directory") return 1;

      let comp = 0;
      if (sortField === "name") {
        comp = a.name.localeCompare(b.name, undefined, { numeric: true, sensitivity: "base" });
      } else if (sortField === "size") {
        comp = a.size - b.size;
      } else if (sortField === "mode") {
        comp = (a.mode || "").localeCompare(b.mode || "");
      } else if (sortField === "modified") {
        comp = (a.modified || "").localeCompare(b.modified || "");
      }

      return sortOrder === "asc" ? comp : -comp;
    });

    return list;
  }, [listing, searchQuery, sortField, sortOrder]);

  const handleSort = (field: "name" | "size" | "mode" | "modified") => {
    if (sortField === field) {
      setSortOrder(sortOrder === "asc" ? "desc" : "asc");
    } else {
      setSortField(field);
      setSortOrder("asc");
    }
  };

  // Selection helpers
  const isAllSelected = displayedEntries.length > 0 && displayedEntries.every((e) => selectedPaths.has(e.path));
  const toggleSelectAll = () => {
    if (isAllSelected) {
      setSelectedPaths(new Set());
    } else {
      setSelectedPaths(new Set(displayedEntries.map((e) => e.path)));
    }
  };

  const toggleSelect = (path: string, event: React.MouseEvent) => {
    event.stopPropagation();
    const next = new Set(selectedPaths);
    if (next.has(path)) next.delete(path);
    else next.add(path);
    setSelectedPaths(next);
  };

  const getSelectedEntries = (): Entry[] => {
    if (!listing) return [];
    return listing.entries.filter((e) => selectedPaths.has(e.path));
  };

  // Editor
  const openFile = async (entry: Entry) => {
    if (entry.isMedia) {
      setPreviewMedia({
        path: entry.path,
        name: entry.name,
        mediaType: entry.mediaType || "image",
        ext: entry.ext || "",
      });
      return;
    }

    if (entry.isArchive) {
      setExtractModal({
        open: true,
        entry,
        destination: listing?.path || getDirname(entry.path),
      });
      return;
    }

    try {
      const result = await api.get<{
        path: string;
        content: string;
        size: number;
        binary: boolean;
        mode: string;
        owner: string;
        ext: string;
      }>(`/files/read?path=${encodeURIComponent(entry.path)}`);

      setEditor({
        path: result.path,
        content: result.content,
        originalContent: result.content,
        binary: result.binary,
        size: result.size,
        mode: result.mode,
        owner: result.owner,
        ext: result.ext,
      });
    } catch (caught) {
      toast("error", errorMessage(caught));
    }
  };

  const saveFile = async (closeAfter = false) => {
    if (!editor) return;
    setBusy(true);
    try {
      await api.put("/files/write", { path: editor.path, content: editor.content });
      setEditor((prev) => (prev ? { ...prev, originalContent: prev.content } : null));
      toast("ok", "File saved successfully");
      if (closeAfter) setEditor(null);
      if (listing) await browse(listing.path, true);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  // Upload
  const handleUploadFiles = async (files: FileList | null) => {
    if (!files || files.length === 0 || !listing) return;
    setBusy(true);
    const form = new FormData();
    form.append("path", listing.path);
    for (let i = 0; i < files.length; i++) {
      form.append("files", files[i]);
    }

    try {
      const res = await api.postForm<{ ok: boolean; count: number; message: string }>("/files/upload", form);
      toast("ok", res.message || `Uploaded ${files.length} file(s)`);
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  // Drag and Drop handlers
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDraggingOver(false);
    if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
      await handleUploadFiles(e.dataTransfer.files);
    }
  };

  // Keyboard shortcut listener (Ctrl+S / Cmd+S in editor)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key === "s") {
        if (editor && !editor.binary) {
          e.preventDefault();
          saveFile(false);
        }
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [editor]);

  // Operations
  const handleCreateFile = async () => {
    if (!newFileName.trim() || !listing) return;
    setBusy(true);
    try {
      const target = joinPath(listing.path, newFileName.trim());
      await api.post("/files/touch", { path: target });
      toast("ok", `File ${newFileName.trim()} created`);
      setNewFileModal(false);
      setNewFileName("");
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!newFolderName.trim() || !listing) return;
    setBusy(true);
    try {
      const target = joinPath(listing.path, newFolderName.trim());
      await api.post("/files/mkdir", { path: target });
      toast("ok", `Folder ${newFolderName.trim()} created`);
      setNewFolderModal(false);
      setNewFolderName("");
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleRename = async () => {
    if (!renaming || !renameTo.trim() || !listing) return;
    setBusy(true);
    try {
      const dest = joinPath(listing.path, renameTo.trim());
      await api.post("/files/rename", { from: renaming.path, to: dest });
      toast("ok", "Renamed successfully");
      setRenaming(null);
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!deletingEntries || deletingEntries.length === 0 || !listing) return;
    setBusy(true);
    try {
      const paths = deletingEntries.map((e) => e.path);
      await api.post("/files/delete", { paths });
      toast("ok", `Deleted ${paths.length} item(s)`);
      setDeletingEntries(null);
      setSelectedPaths(new Set());
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleChmod = async () => {
    if (chmodModal.entries.length === 0 || !listing) return;
    setBusy(true);
    try {
      await api.post("/files/chmod", {
        paths: chmodModal.entries.map((e) => e.path),
        mode: chmodModal.mode,
        recursive: chmodModal.recursive,
      });
      toast("ok", `Permissions updated to ${chmodModal.mode}`);
      setChmodModal({ open: false, entries: [], mode: "0644", recursive: false });
      await browse(listing.path, true);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleChown = async () => {
    if (chownModal.entries.length === 0 || !listing) return;
    setBusy(true);
    try {
      await api.post("/files/chown", {
        paths: chownModal.entries.map((e) => e.path),
        user: chownModal.user,
        group: chownModal.group,
        recursive: chownModal.recursive,
      });
      toast("ok", `Ownership updated to ${chownModal.user}:${chownModal.group}`);
      setChownModal({ open: false, entries: [], user: "www-data", group: "www-data", recursive: false });
      await browse(listing.path, true);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleCompress = async () => {
    if (compressModal.entries.length === 0 || !listing) return;
    setBusy(true);
    try {
      await api.post("/files/compress", {
        paths: compressModal.entries.map((e) => e.path),
        destination: listing.path,
        name: compressModal.archiveName,
        format: compressModal.format,
      });
      toast("ok", `Archive created successfully`);
      setCompressModal({ open: false, entries: [], archiveName: "", format: "zip" });
      setSelectedPaths(new Set());
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleExtract = async () => {
    if (!extractModal.entry) return;
    setBusy(true);
    try {
      await api.post("/files/extract", {
        archivePath: extractModal.entry.path,
        destination: extractModal.destination,
      });
      toast("ok", `Archive extracted successfully`);
      setExtractModal({ open: false, entry: null, destination: "" });
      if (listing) await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const handleCopyMove = async () => {
    if (copyMoveModal.entries.length === 0 || !copyMoveModal.destination || !listing) return;
    setBusy(true);
    const endpoint = copyMoveModal.mode === "copy" ? "/files/copy" : "/files/move";
    try {
      await api.post(endpoint, {
        sources: copyMoveModal.entries.map((e) => e.path),
        destination: copyMoveModal.destination,
      });
      toast("ok", `${copyMoveModal.mode === "copy" ? "Copied" : "Moved"} items successfully`);
      setCopyMoveModal({ open: false, mode: "copy", entries: [], destination: "" });
      setSelectedPaths(new Set());
      await browse(listing.path);
    } catch (caught) {
      toast("error", errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const segments = listing ? listing.path.split("/").filter(Boolean) : [];

  return (
    <div
      className="space-y-4 relative"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Drag & Drop Visual Overlay */}
      {isDraggingOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-[var(--axon-card)]/90 backdrop-blur-sm border-2 border-dashed border-[var(--axon-primary)] rounded-xl pointer-events-none">
          <div className="text-center p-6 space-y-2">
            <svg className="h-12 w-12 mx-auto text-[var(--axon-primary)] animate-bounce" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            <p className="text-base font-bold text-[var(--axon-text)]">Drop files to upload</p>
            <p className="text-xs text-[var(--axon-muted)]">Upload to: <span className="mono text-white">{listing?.path}</span></p>
          </div>
        </div>
      )}

      {/* Top Header & Primary Action Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-[var(--axon-text)]">File Manager</h1>
          <p className="text-xs text-[var(--axon-muted)]">
            Webhosting-grade server filesystem management with code editing, archive compression, and permission controls.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2">
          <input
            ref={fileInputRef}
            type="file"
            multiple
            className="hidden"
            onChange={(e) => handleUploadFiles(e.target.files)}
          />
          <Button variant="primary" onClick={() => fileInputRef.current?.click()} disabled={!listing || busy}>
            ↑ Upload Files
          </Button>
          <Button variant="secondary" onClick={() => setNewFileModal(true)} disabled={!listing}>
            + New File
          </Button>
          <Button variant="secondary" onClick={() => setNewFolderModal(true)} disabled={!listing}>
            + New Folder
          </Button>
          <Button variant="ghost" onClick={() => listing && browse(listing.path)} disabled={!listing || loading}>
            ↻ Refresh
          </Button>
        </div>
      </div>

      <ErrorBanner message={error} />

      {/* Bookmarks / Quick Roots Navigation */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] font-bold uppercase text-[var(--axon-muted)] mr-1">Locations:</span>
          {shortcuts.map((sc) => (
            <button
              key={sc.path}
              onClick={() => browse(sc.path)}
              className={`mono rounded-lg border px-2.5 py-1 text-xs transition-colors ${
                listing?.path === sc.path
                  ? "border-[var(--axon-primary)] bg-[var(--axon-primary)]/10 text-[var(--axon-primary)] font-semibold shadow-xs"
                  : "border-[var(--axon-border)] bg-[var(--axon-card)] text-slate-300 hover:border-slate-500 hover:text-white"
              }`}
            >
              {sc.label || sc.path}
            </button>
          ))}
        </div>

        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1.5 text-xs text-[var(--axon-muted)] cursor-pointer select-none">
            <input
              type="checkbox"
              checked={showHidden}
              onChange={(e) => setShowHidden(e.target.checked)}
              className="rounded border-[var(--axon-border)]"
            />
            <span>Show Hidden Files</span>
          </label>
        </div>
      </div>

      {/* Main Filesystem Panel */}
      <Card bodyClassName="p-0">
        {/* Breadcrumb & Path Address Bar */}
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-[var(--axon-border)] px-4 py-2.5 bg-[var(--axon-card-hover)]">
          <div className="flex items-center gap-1.5 flex-1 min-w-[280px]">
            <Button
              variant="ghost"
              className="px-2 py-1 text-xs"
              onClick={() => listing && browse(listing.parent)}
              disabled={!listing || listing.path === "/"}
              title="Go up one level"
            >
              ↑ Up
            </Button>

            {/* Clickable Breadcrumbs */}
            <div className="mono flex items-center gap-1 text-xs overflow-x-auto select-none py-1">
              <button
                className="font-bold text-slate-400 hover:text-[var(--axon-primary)] transition"
                onClick={() => browse("/")}
              >
                /
              </button>
              {segments.map((segment, index) => (
                <span key={`${segment}-${index}`} className="flex items-center gap-1">
                  <button
                    className={`hover:text-[var(--axon-primary)] transition ${
                      index === segments.length - 1 ? "font-bold text-white" : "text-slate-400"
                    }`}
                    onClick={() => browse(`/${segments.slice(0, index + 1).join("/")}`)}
                  >
                    {segment}
                  </button>
                  {index < segments.length - 1 && <span className="text-slate-600">/</span>}
                </span>
              ))}
            </div>
          </div>

          {/* Quick Jump & Filter */}
          <div className="flex items-center gap-2 w-full sm:w-auto">
            <div className="relative">
              <input
                className="field text-xs pl-7 pr-2 py-1 w-44 sm:w-48"
                placeholder="Filter in folder…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
              />
              <svg className="h-3.5 w-3.5 absolute left-2 top-2 text-slate-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <circle cx="11" cy="11" r="8" />
                <line x1="21" y1="21" x2="16.65" y2="16.65" />
              </svg>
              {searchQuery && (
                <button
                  onClick={() => setSearchQuery("")}
                  className="absolute right-2 top-1.5 text-xs text-slate-500 hover:text-white"
                >
                  ✕
                </button>
              )}
            </div>

            <form
              className="flex items-center gap-1"
              onSubmit={(e) => {
                e.preventDefault();
                browse(pathInput);
              }}
            >
              <input
                className="field mono text-xs w-48 sm:w-56 py-1"
                placeholder="/var/www/..."
                value={pathInput}
                onChange={(e) => setPathInput(e.target.value)}
              />
              <Button type="submit" variant="ghost" className="px-2 py-1 text-xs">
                Go
              </Button>
            </form>
          </div>
        </div>

        {/* Batch Selection Action Bar (Shown when items are selected) */}
        {selectedPaths.size > 0 && (
          <div className="bg-[var(--axon-primary)]/10 border-b border-[var(--axon-primary)]/30 px-4 py-2 flex flex-wrap items-center justify-between gap-2 text-xs">
            <div className="flex items-center gap-2">
              <span className="font-bold text-[var(--axon-primary)]">
                {selectedPaths.size} item{selectedPaths.size > 1 ? "s" : ""} selected
              </span>
              <button
                type="button"
                onClick={() => setSelectedPaths(new Set())}
                className="text-[11px] text-[var(--axon-muted)] hover:underline ml-2"
              >
                Deselect all
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <Button
                variant="ghost"
                className="text-xs py-0.5 px-2"
                onClick={() => {
                  const items = getSelectedEntries();
                  setCopyMoveModal({
                    open: true,
                    mode: "copy",
                    entries: items,
                    destination: listing?.path || "/var/www",
                  });
                }}
              >
                📋 Copy
              </Button>

              <Button
                variant="ghost"
                className="text-xs py-0.5 px-2"
                onClick={() => {
                  const items = getSelectedEntries();
                  setCopyMoveModal({
                    open: true,
                    mode: "move",
                    entries: items,
                    destination: listing?.path || "/var/www",
                  });
                }}
              >
                ✂ Move
              </Button>

              <Button
                variant="ghost"
                className="text-xs py-0.5 px-2"
                onClick={() => {
                  const items = getSelectedEntries();
                  setCompressModal({
                    open: true,
                    entries: items,
                    archiveName: `${getBasename(listing?.path || "backup")}-${Date.now()}.zip`,
                    format: "zip",
                  });
                }}
              >
                📦 Compress
              </Button>

              <Button
                variant="ghost"
                className="text-xs py-0.5 px-2"
                onClick={() => {
                  const items = getSelectedEntries();
                  setChmodModal({
                    open: true,
                    entries: items,
                    mode: items[0]?.mode || "0644",
                    recursive: items.some((i) => i.kind === "directory"),
                  });
                }}
              >
                🔒 Permissions
              </Button>

              <Button
                variant="ghost"
                className="text-xs py-0.5 px-2"
                onClick={() => {
                  const items = getSelectedEntries();
                  setChownModal({
                    open: true,
                    entries: items,
                    user: items[0]?.owner || "www-data",
                    group: items[0]?.group || "www-data",
                    recursive: items.some((i) => i.kind === "directory"),
                  });
                }}
              >
                👤 Ownership
              </Button>

              <Button
                variant="danger"
                className="text-xs py-0.5 px-2"
                onClick={() => setDeletingEntries(getSelectedEntries())}
              >
                🗑 Delete ({selectedPaths.size})
              </Button>
            </div>
          </div>
        )}

        {/* File Table */}
        <div className="max-h-[66vh] overflow-auto">
          {loading ? (
            <div className="flex items-center justify-center p-12 text-sm text-[var(--axon-muted)]">
              <Spinner className="mr-2" /> Loading directory…
            </div>
          ) : (
            <table className="w-full text-left text-xs border-collapse">
              <thead className="sticky top-0 z-10 bg-[var(--axon-card)] border-b border-[var(--axon-border)] shadow-xs">
                <tr className="text-[11px] font-bold uppercase tracking-wider text-[var(--axon-muted)]">
                  <th className="py-2.5 pl-4 pr-2 w-8">
                    <input
                      type="checkbox"
                      checked={isAllSelected}
                      onChange={toggleSelectAll}
                      className="rounded border-[var(--axon-border)]"
                      title="Select all"
                    />
                  </th>
                  <th className="py-2.5 px-2 cursor-pointer hover:text-white" onClick={() => handleSort("name")}>
                    Name {sortField === "name" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white text-right w-24" onClick={() => handleSort("size")}>
                    Size {sortField === "size" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white text-center w-24" onClick={() => handleSort("mode")}>
                    Permissions {sortField === "mode" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 px-3 w-28">Owner:Group</th>
                  <th className="py-2.5 px-3 cursor-pointer hover:text-white w-32" onClick={() => handleSort("modified")}>
                    Modified {sortField === "modified" ? (sortOrder === "asc" ? "▲" : "▼") : ""}
                  </th>
                  <th className="py-2.5 pr-4 pl-2 text-right w-44">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-[var(--axon-border)]">
                {displayedEntries.map((entry) => {
                  const isSelected = selectedPaths.has(entry.path);
                  return (
                    <tr
                      key={entry.path}
                      onClick={() => (entry.kind === "directory" ? browse(entry.path) : openFile(entry))}
                      className={`hover:bg-[var(--axon-card-hover)] cursor-pointer transition select-none ${
                        isSelected ? "bg-[var(--axon-primary)]/10" : ""
                      }`}
                    >
                      <td className="py-2 pl-4 pr-2" onClick={(e) => toggleSelect(entry.path, e)}>
                        <input
                          type="checkbox"
                          checked={isSelected}
                          onChange={() => {}}
                          className="rounded border-[var(--axon-border)] cursor-pointer"
                        />
                      </td>

                      {/* Name with File Icon */}
                      <td className="py-2 px-2">
                        <div className="flex items-center gap-2">
                          <FileTypeIcon entry={entry} />
                          <span
                            className={`mono font-medium truncate max-w-md ${
                              entry.kind === "directory"
                                ? "text-[var(--axon-text)] font-semibold hover:text-[var(--axon-primary)]"
                                : "text-slate-300 hover:text-white"
                            }`}
                            title={entry.name}
                          >
                            {entry.name}
                          </span>
                          {entry.symlink && <Badge tone="neutral">symlink</Badge>}
                          {entry.isArchive && <Badge tone="info">archive</Badge>}
                        </div>
                      </td>

                      {/* Size */}
                      <td className="py-2 px-3 text-right mono text-[11px] text-[var(--axon-muted)]">
                        {entry.kind === "directory" ? "—" : formatBytes(entry.size)}
                      </td>

                      {/* Permissions (Chmod Badge) */}
                      <td className="py-2 px-3 text-center">
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            setChmodModal({
                              open: true,
                              entries: [entry],
                              mode: entry.mode || "0644",
                              recursive: entry.kind === "directory",
                            });
                          }}
                          className="mono text-[10px] px-1.5 py-0.5 rounded bg-[var(--axon-input-bg)] border border-[var(--axon-border)] hover:border-[var(--axon-primary)] text-slate-300"
                          title="Click to edit permissions"
                        >
                          {entry.mode || "—"}
                        </button>
                      </td>

                      {/* Owner : Group */}
                      <td className="py-2 px-3 mono text-[11px] text-[var(--axon-muted)] truncate">
                        {entry.owner || "root"}:{entry.group || "root"}
                      </td>

                      {/* Modified Date */}
                      <td className="py-2 px-3 text-[11px] text-[var(--axon-muted)]" title={formatDate(entry.modified)}>
                        {relativeTime(entry.modified)}
                      </td>

                      {/* Actions */}
                      <td className="py-2 pr-4 pl-2 text-right">
                        <div className="flex items-center justify-end gap-1" onClick={(e) => e.stopPropagation()}>
                          {entry.kind === "directory" ? (
                            <a
                              className="btn btn-ghost text-xs py-0.5 px-2"
                              href={`/api/files/download?path=${encodeURIComponent(entry.path)}`}
                              title="Download directory as ZIP"
                            >
                              ⬇ Zip
                            </a>
                          ) : (
                            <a
                              className="btn btn-ghost text-xs py-0.5 px-2"
                              href={`/api/files/download?path=${encodeURIComponent(entry.path)}`}
                              title="Download file"
                            >
                              ⬇
                            </a>
                          )}

                          {entry.isArchive && (
                            <Button
                              variant="ghost"
                              className="text-xs py-0.5 px-2 text-purple-400"
                              onClick={() =>
                                setExtractModal({
                                  open: true,
                                  entry,
                                  destination: listing?.path || getDirname(entry.path),
                                })
                              }
                            >
                              Extract
                            </Button>
                          )}

                          <Button
                            variant="ghost"
                            className="text-xs py-0.5 px-2"
                            onClick={() => {
                              setRenaming(entry);
                              setRenameTo(entry.name);
                            }}
                          >
                            Rename
                          </Button>

                          <Button
                            variant="ghost"
                            className="text-xs py-0.5 px-1.5 text-rose-400 hover:bg-rose-500/10"
                            onClick={() => setDeletingEntries([entry])}
                          >
                            ✕
                          </Button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}

          {listing?.entries.length === 0 && (
            <div className="py-12">
              <EmptyState message="This directory is empty. Use the Upload or New File buttons above to add files." />
            </div>
          )}
        </div>

        {/* Directory Statistics Footer */}
        {listing?.stats && (
          <div className="border-t border-[var(--axon-border)] bg-[var(--axon-card-hover)] px-4 py-2 flex flex-wrap items-center justify-between text-[11px] text-[var(--axon-muted)]">
            <div>
              <span>{listing.stats.totalDirs} Folders</span> · <span>{listing.stats.totalFiles} Files</span> ·{" "}
              <span>Total size: {formatBytes(listing.stats.totalBytes)}</span>
            </div>
            <div>
              <span>Path: <strong className="mono text-white">{listing.path}</strong></span>
            </div>
          </div>
        )}
      </Card>

      {/* Modal: Webhosting Code & Text Editor */}
      <Modal
        open={Boolean(editor)}
        title={`Edit File · ${getBasename(editor?.path || "")}`}
        onClose={() => setEditor(null)}
        width="max-w-5xl"
      >
        {editor?.binary ? (
          <div className="p-6 text-center space-y-3">
            <p className="text-sm text-slate-300">This file is binary or exceeds supported web editing limits.</p>
            <a
              className="btn btn-primary"
              href={`/api/files/download?path=${encodeURIComponent(editor.path)}`}
            >
              Download File
            </a>
          </div>
        ) : (
          <div className="space-y-3">
            {/* Editor Top Bar Info */}
            <div className="flex flex-wrap items-center justify-between gap-2 text-xs border-b border-[var(--axon-border)] pb-2 text-[var(--axon-muted)]">
              <div className="flex items-center gap-2">
                <span className="mono text-white font-semibold truncate max-w-md">{editor?.path}</span>
                <span className="mono uppercase text-[10px] px-1.5 py-0.5 rounded bg-[var(--axon-input-bg)] border border-[var(--axon-border)]">
                  {editor?.ext?.replace(".", "") || "txt"}
                </span>
              </div>
              <div className="flex items-center gap-3 text-[11px]">
                <span>Size: {formatBytes(editor?.size ?? 0)}</span>
                <span>Mode: {editor?.mode}</span>
                <span>Owner: {editor?.owner}</span>
              </div>
            </div>

            {/* Editor Area with Monospace Font and Clean Padding */}
            <textarea
              className="field mono text-xs w-full h-[58vh] resize-y leading-relaxed bg-[#0a0f18] text-slate-100 border-[var(--axon-border)] focus:border-[var(--axon-primary)] font-mono p-3"
              spellCheck={false}
              value={editor?.content ?? ""}
              onChange={(e) => setEditor((prev) => (prev ? { ...prev, content: e.target.value } : null))}
            />

            <div className="flex flex-wrap items-center justify-between gap-2 pt-2 text-[11px] text-[var(--axon-muted)]">
              <div>
                <span>A backup copy (<code className="mono text-slate-300">.panel-bak</code>) is created automatically upon saving.</span>
              </div>
              <div className="flex items-center gap-2">
                <Button onClick={() => setEditor(null)} disabled={busy}>
                  Cancel
                </Button>
                <Button variant="secondary" loading={busy} onClick={() => saveFile(false)}>
                  Save
                </Button>
                <Button variant="primary" loading={busy} onClick={() => saveFile(true)}>
                  Save & Close
                </Button>
              </div>
            </div>
          </div>
        )}
      </Modal>

      {/* Modal: Media Preview (Images, Audio, Video, PDF) */}
      <Modal
        open={Boolean(previewMedia)}
        title={`Preview · ${previewMedia?.name || ""}`}
        onClose={() => setPreviewMedia(null)}
        width="max-w-3xl"
      >
        <div className="space-y-4 text-center">
          {previewMedia?.mediaType === "image" && (
            <div className="flex items-center justify-center p-4 bg-black/40 rounded-xl overflow-hidden max-h-[65vh]">
              <img
                src={`/api/files/preview?path=${encodeURIComponent(previewMedia.path)}`}
                alt={previewMedia.name}
                className="max-h-[60vh] max-w-full object-contain rounded"
              />
            </div>
          )}

          {previewMedia?.mediaType === "video" && (
            <div className="p-2 bg-black rounded-xl">
              <video
                controls
                src={`/api/files/preview?path=${encodeURIComponent(previewMedia.path)}`}
                className="max-h-[60vh] w-full rounded"
              />
            </div>
          )}

          {previewMedia?.mediaType === "audio" && (
            <div className="p-6 bg-[var(--axon-card)] rounded-xl">
              <audio controls src={`/api/files/preview?path=${encodeURIComponent(previewMedia.path)}`} className="w-full" />
            </div>
          )}

          {previewMedia?.mediaType === "pdf" && (
            <iframe
              src={`/api/files/preview?path=${encodeURIComponent(previewMedia.path)}`}
              className="w-full h-[65vh] rounded-xl border border-[var(--axon-border)]"
              title="PDF Viewer"
            />
          )}

          <div className="flex justify-between items-center pt-2">
            <span className="mono text-xs text-[var(--axon-muted)] truncate max-w-md">{previewMedia?.path}</span>
            <div className="flex items-center gap-2">
              <a
                className="btn btn-secondary text-xs"
                href={`/api/files/download?path=${encodeURIComponent(previewMedia?.path || "")}`}
              >
                Download File
              </a>
              <Button onClick={() => setPreviewMedia(null)}>Close</Button>
            </div>
          </div>
        </div>
      </Modal>

      {/* Modal: New File */}
      <Modal open={newFileModal} title="Create New File" onClose={() => setNewFileModal(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateFile();
          }}
          className="space-y-4"
        >
          <Field label="File Name" hint="e.g. index.php, style.css, .env">
            <input
              className="field mono text-xs w-full"
              placeholder="index.php"
              value={newFileName}
              onChange={(e) => setNewFileName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <p className="text-xs text-[var(--axon-muted)]">
            Will be created in: <code className="mono text-white">{listing?.path}</code>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setNewFileModal(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} type="submit" disabled={!newFileName.trim()}>
              Create File
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: New Folder */}
      <Modal open={newFolderModal} title="Create New Folder" onClose={() => setNewFolderModal(false)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleCreateFolder();
          }}
          className="space-y-4"
        >
          <Field label="Folder Name" hint="e.g. assets, uploads, logs">
            <input
              className="field mono text-xs w-full"
              placeholder="uploads"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <p className="text-xs text-[var(--axon-muted)]">
            Will be created in: <code className="mono text-white">{listing?.path}</code>
          </p>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setNewFolderModal(false)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} type="submit" disabled={!newFolderName.trim()}>
              Create Folder
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Rename */}
      <Modal open={Boolean(renaming)} title="Rename Item" onClose={() => setRenaming(null)}>
        <form
          onSubmit={(e) => {
            e.preventDefault();
            handleRename();
          }}
          className="space-y-4"
        >
          <Field label="New Name">
            <input
              className="field mono text-xs w-full"
              value={renameTo}
              onChange={(e) => setRenameTo(e.target.value)}
              required
              autoFocus
            />
          </Field>
          <div className="flex justify-end gap-2 pt-2">
            <Button onClick={() => setRenaming(null)} disabled={busy}>
              Cancel
            </Button>
            <Button variant="primary" loading={busy} type="submit" disabled={!renameTo.trim()}>
              Rename
            </Button>
          </div>
        </form>
      </Modal>

      {/* Modal: Chmod / Change Permissions */}
      <Modal
        open={chmodModal.open}
        title={`Change Permissions (chmod) · ${chmodModal.entries.length} item(s)`}
        onClose={() => setChmodModal({ open: false, entries: [], mode: "0644", recursive: false })}
      >
        <div className="space-y-4 text-xs">
          <Field label="Octal Permission Mode" hint="e.g. 0644 (Standard File), 0755 (Directory/Script), 0600 (Secret)">
            <input
              className="field mono text-xs w-full"
              value={chmodModal.mode}
              onChange={(e) => setChmodModal({ ...chmodModal, mode: e.target.value })}
              placeholder="0644"
              required
            />
          </Field>

          {/* Quick Permission Presets */}
          <div className="space-y-1">
            <span className="text-[11px] font-bold uppercase text-[var(--axon-muted)]">Common Presets:</span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-2 border border-[var(--axon-border)]"
                onClick={() => setChmodModal({ ...chmodModal, mode: "0644" })}
              >
                0644 · Standard File
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-2 border border-[var(--axon-border)]"
                onClick={() => setChmodModal({ ...chmodModal, mode: "0755" })}
              >
                0755 · Directory / Executable
              </button>
              <button
                type="button"
                className="btn btn-ghost text-xs py-1 px-2 border border-[var(--axon-border)]"
                onClick={() => setChmodModal({ ...chmodModal, mode: "0600" })}
              >
                0600 · Private / wp-config
              </button>
            </div>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-2">
            <input
              type="checkbox"
              checked={chmodModal.recursive}
              onChange={(e) => setChmodModal({ ...chmodModal, recursive: e.target.checked })}
              className="rounded border-[var(--axon-border)]"
            />
            <span className="text-slate-300">Apply recursively (-R) to all subdirectories and files</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button
              onClick={() => setChmodModal({ open: false, entries: [], mode: "0644", recursive: false })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleChmod} disabled={!/^[0-7]{3,4}$/.test(chmodModal.mode)}>
              Apply Permissions
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Chown / Change Ownership */}
      <Modal
        open={chownModal.open}
        title={`Change Ownership (chown) · ${chownModal.entries.length} item(s)`}
        onClose={() => setChownModal({ open: false, entries: [], user: "www-data", group: "www-data", recursive: false })}
      >
        <div className="space-y-4 text-xs">
          <div className="grid grid-cols-2 gap-3">
            <Field label="User Owner">
              <input
                className="field mono text-xs w-full"
                value={chownModal.user}
                onChange={(e) => setChownModal({ ...chownModal, user: e.target.value })}
                required
              />
            </Field>
            <Field label="Group Owner">
              <input
                className="field mono text-xs w-full"
                value={chownModal.group}
                onChange={(e) => setChownModal({ ...chownModal, group: e.target.value })}
                required
              />
            </Field>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              className="btn btn-ghost text-xs py-1 px-2 border border-[var(--axon-border)]"
              onClick={() => setChownModal({ ...chownModal, user: "www-data", group: "www-data" })}
            >
              www-data : www-data (Web Server)
            </button>
            <button
              type="button"
              className="btn btn-ghost text-xs py-1 px-2 border border-[var(--axon-border)]"
              onClick={() => setChownModal({ ...chownModal, user: "root", group: "root" })}
            >
              root : root (System)
            </button>
          </div>

          <label className="flex items-center gap-2 cursor-pointer pt-1">
            <input
              type="checkbox"
              checked={chownModal.recursive}
              onChange={(e) => setChownModal({ ...chownModal, recursive: e.target.checked })}
              className="rounded border-[var(--axon-border)]"
            />
            <span className="text-slate-300">Apply recursively (-R) to all subdirectories</span>
          </label>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button
              onClick={() => setChownModal({ open: false, entries: [], user: "www-data", group: "www-data", recursive: false })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleChown}>
              Change Ownership
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Compress (Zip / Tar) */}
      <Modal
        open={compressModal.open}
        title={`Compress & Archive · ${compressModal.entries.length} item(s)`}
        onClose={() => setCompressModal({ open: false, entries: [], archiveName: "", format: "zip" })}
      >
        <div className="space-y-4 text-xs">
          <Field label="Archive Name" hint="e.g. backup-2026.zip or site-assets.tar.gz">
            <input
              className="field mono text-xs w-full"
              value={compressModal.archiveName}
              onChange={(e) => setCompressModal({ ...compressModal, archiveName: e.target.value })}
              required
            />
          </Field>

          <Field label="Archive Format">
            <div className="flex items-center gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={compressModal.format === "zip"}
                  onChange={() => setCompressModal({ ...compressModal, format: "zip" })}
                />
                <span>ZIP Archive (.zip)</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input
                  type="radio"
                  name="format"
                  checked={compressModal.format === "tar.gz"}
                  onChange={() => setCompressModal({ ...compressModal, format: "tar.gz" })}
                />
                <span>Gzip Tarball (.tar.gz)</span>
              </label>
            </div>
          </Field>

          <p className="text-[11px] text-[var(--axon-muted)]">
            Archive will be generated inside: <code className="mono text-white">{listing?.path}</code>
          </p>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button
              onClick={() => setCompressModal({ open: false, entries: [], archiveName: "", format: "zip" })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleCompress}>
              Compress Files
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Extract Archive */}
      <Modal
        open={extractModal.open}
        title={`Extract Archive · ${extractModal.entry?.name || ""}`}
        onClose={() => setExtractModal({ open: false, entry: null, destination: "" })}
      >
        <div className="space-y-4 text-xs">
          <p className="text-[var(--axon-muted)]">
            Extracting archive contents. Existing files with matching names will be safely replaced.
          </p>

          <Field label="Extract Destination Directory">
            <input
              className="field mono text-xs w-full"
              value={extractModal.destination}
              onChange={(e) => setExtractModal({ ...extractModal, destination: e.target.value })}
              required
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button
              onClick={() => setExtractModal({ open: false, entry: null, destination: "" })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleExtract}>
              Extract Archive Here
            </Button>
          </div>
        </div>
      </Modal>

      {/* Modal: Copy / Move */}
      <Modal
        open={copyMoveModal.open}
        title={`${copyMoveModal.mode === "copy" ? "Copy" : "Move"} ${copyMoveModal.entries.length} Item(s)`}
        onClose={() => setCopyMoveModal({ open: false, mode: "copy", entries: [], destination: "" })}
      >
        <div className="space-y-4 text-xs">
          <Field label="Destination Directory">
            <input
              className="field mono text-xs w-full"
              value={copyMoveModal.destination}
              onChange={(e) => setCopyMoveModal({ ...copyMoveModal, destination: e.target.value })}
              placeholder="/var/www/..."
              required
            />
          </Field>

          <div className="flex justify-end gap-2 pt-2 border-t border-[var(--axon-border)]">
            <Button
              onClick={() => setCopyMoveModal({ open: false, mode: "copy", entries: [], destination: "" })}
              disabled={busy}
            >
              Cancel
            </Button>
            <Button variant="primary" loading={busy} onClick={handleCopyMove}>
              {copyMoveModal.mode === "copy" ? "Copy Here" : "Move Here"}
            </Button>
          </div>
        </div>
      </Modal>

      {/* Confirm: Delete Dialog */}
      <ConfirmDialog
        open={Boolean(deletingEntries && deletingEntries.length > 0)}
        title="Confirm Deletion"
        message={
          <>
            Are you sure you want to permanently delete{" "}
            <span className="mono text-amber-300 font-bold">
              {deletingEntries?.length === 1 ? deletingEntries[0].name : `${deletingEntries?.length} selected items`}
            </span>
            ? This action cannot be undone.
          </>
        }
        confirmLabel={`Delete ${deletingEntries?.length || 1} Item(s)`}
        busy={busy}
        onCancel={() => setDeletingEntries(null)}
        onConfirm={handleDelete}
      />
    </div>
  );
}

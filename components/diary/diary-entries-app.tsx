"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type MouseEvent, type PointerEvent } from "react";
import { Bot, ChevronLeft, Clock3, NotebookPen, Trash2, WandSparkles, X } from "lucide-react";
import { DotsThree } from "@phosphor-icons/react";

import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { generateDiaryEntryForCharacter } from "@/lib/diary-entry-engine";
import { useDiaryGenerating } from "@/lib/diary-generating-tracker";
import {
  DIARY_ENTRIES_UPDATED_EVENT,
  DIARY_ENTRY_TIMER_SETTINGS_UPDATED_EVENT,
} from "@/lib/diary-entry-timer-service";
import {
  createDiaryEntry,
  deleteDiaryEntry,
  loadDiaryEntries,
  loadDiaryEntryFontAssetId,
  loadDiaryEntryFontScale,
  loadDiaryEntryTimerSettings,
  saveDiaryEntryFontAssetId,
  saveDiaryEntryFontScale,
  saveDiaryEntryTimerSettings,
  loadDiaryCustomFonts,
  saveDiaryCustomFonts,
  loadDiaryCharacterFontMap,
  saveDiaryCharacterFontMap,
  type DiaryCustomFont,
} from "@/lib/diary-entry-storage";
import type { DiaryEntry, DiaryEntryBlock, DiaryEntryTimerSettings, DiaryEntryTrigger } from "@/lib/diary-entry-types";
import { getThemeAssetDataUrl, saveThemeAssetFromBlob } from "@/lib/theme-storage";

const DIARY_USER_FONT_STYLE_ID = "ai-phone-diary-entry-user-font-face";

const PRESET_DIARY_FONTS = [
  { id: "ximai", name: "喜脉体 (手写)", family: '"NoteWall Ximai", var(--app-font-family)' },
  { id: "xiaozhitiao", name: "小纸条体 (手写)", family: '"NoteWall Xiaozhitiao", var(--app-font-family)' },
  { id: "chenyuluoyan", name: "沉鱼落雁体 (手写细)", family: '"NoteWall Chenyuluoyan", var(--app-font-family)' },
  { id: "huiwen", name: "汇文体 (印刷仿宋)", family: '"NoteWall Huiwen", var(--app-font-family)' },
  { id: "system", name: "系统默认", family: 'var(--app-font-family)' },
];

type DiaryEntriesAppProps = {
  onBack: () => void;
  onNotice?: (message: string) => void;
};

type DiaryBook = {
  characterId: string;
  characterName: string;
  avatar: string;
  entries: DiaryEntry[];
};

type DiaryEntryDragState = {
  entry: DiaryEntry;
  x: number;
  y: number;
  width: number;
  height: number;
  isOverTrash: boolean;
};

type DiaryEntryDragSession = {
  entry: DiaryEntry;
  pointerId: number;
  target: HTMLButtonElement;
  startX: number;
  startY: number;
  width: number;
  height: number;
  timer: number | null;
  dragging: boolean;
};

type DiaryEntryDragScrollLock = {
  bodyOverflow: string;
  bodyTouchAction: string;
  htmlOverscrollBehavior: string;
  htmlTouchAction: string;
  main: HTMLElement | null;
  mainOverflow: string;
  mainTouchAction: string;
  mainScrollTop: number;
};

function formatEntryTime(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value || "未知时间";
  return `${date.getFullYear()}.${String(date.getMonth() + 1).padStart(2, "0")}.${String(date.getDate()).padStart(2, "0")}`;
}

function clipText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, " ").trim();
  return normalized.length > maxLength ? `${normalized.slice(0, maxLength)}...` : normalized;
}

function blockPlainText(block: DiaryEntryBlock): string {
  if (block.type === "paragraph" || block.type === "quote") return block.text;
  if (block.type === "correction") return block.replacement || block.text;
  if (block.type === "image") return block.caption || block.description;
  if (block.type === "todo") return block.items.map(item => item.text).join(" / ");
  return "";
}

function getEntryMarkers(entry: DiaryEntry): string[] {
  return Array.from(new Set([
    entry.mood,
    ...entry.tags,
    entry.weather,
  ].map(item => item.trim()).filter(Boolean))).slice(0, 4);
}

function DiaryWritingStatus({ label = "写入中" }: { label?: string }) {
  return (
    <span className="diary-writing-status" aria-label={label}>
      <span>{label}</span>
      <span className="diary-writing-dots" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </span>
  );
}

export function DiaryEntriesApp({ onBack, onNotice }: DiaryEntriesAppProps) {
  const [entries, setEntries] = useState<DiaryEntry[]>([]);
  const [characters, setCharacters] = useState<Character[]>([]);
  const [settings, setSettings] = useState<DiaryEntryTimerSettings>(() => loadDiaryEntryTimerSettings());
  const [timerSettingsOpen, setTimerSettingsOpen] = useState(false);
  const [writePanelOpen, setWritePanelOpen] = useState(false);
  const [fontPanelOpen, setFontPanelOpen] = useState(false);
  const [activeEntry, setActiveEntry] = useState<DiaryEntry | null>(null);
  const [deleteCandidateEntry, setDeleteCandidateEntry] = useState<DiaryEntry | null>(null);
  const [activeCharacterId, setActiveCharacterId] = useState<string | null>(null);
  const [localGeneratingIds, setGeneratingCharacterIds] = useState<string[]>([]);
  const [diaryFontAssetId, setDiaryFontAssetId] = useState<string | null>(() => loadDiaryEntryFontAssetId());
  const [diaryFontScale, setDiaryFontScale] = useState<number>(() => loadDiaryEntryFontScale());
  const [customFonts, setCustomFonts] = useState<DiaryCustomFont[]>(() => loadDiaryCustomFonts());
  const [characterFontMap, setCharacterFontMap] = useState<Record<string, string>>(() => loadDiaryCharacterFontMap());
  const [customFontUrls, setCustomFontUrls] = useState<Record<string, string>>({});

  // Merge in the module-level tracker so background generation (timer, or a
  // batch started before leaving the app) is visible again after re-entry.
  const trackedGeneratingIds = useDiaryGenerating();
  const generatingCharacterIds = useMemo(
    () => Array.from(new Set([...localGeneratingIds, ...trackedGeneratingIds])),
    [localGeneratingIds, trackedGeneratingIds],
  );
  const [entryDrag, setEntryDrag] = useState<DiaryEntryDragState | null>(null);
  const entryMainRef = useRef<HTMLElement | null>(null);
  const entryTrashRef = useRef<HTMLDivElement | null>(null);
  const fontFileRef = useRef<HTMLInputElement | null>(null);
  const entryDragRef = useRef<DiaryEntryDragSession | null>(null);
  const entryDragClickSuppressedRef = useRef(false);
  const entryDragClickSuppressTimerRef = useRef<number | null>(null);
  const entryDragScrollLockRef = useRef<DiaryEntryDragScrollLock | null>(null);
  const entryDragTouchMoveBlockerRef = useRef<((event: globalThis.TouchEvent) => void) | null>(null);

  const notify = useCallback((message: string) => {
    onNotice?.(message);
  }, [onNotice]);

  const refreshEntries = useCallback(() => {
    setEntries(loadDiaryEntries());
  }, []);

  // 加载并注入所有自定义上传的字体
  useEffect(() => {
    let cancelled = false;
    const allAssetIds = new Set<string>();
    if (diaryFontAssetId) allAssetIds.add(diaryFontAssetId);
    customFonts.forEach(f => { if (f.assetId) allAssetIds.add(f.assetId); });

    Promise.all(Array.from(allAssetIds).map(async (assetId) => {
      try {
        const dataUrl = await getThemeAssetDataUrl(assetId);
        return { assetId, dataUrl };
      } catch {
        return { assetId, dataUrl: null };
      }
    })).then((results) => {
      if (cancelled) return;
      const map: Record<string, string> = {};
      results.forEach(r => { if (r.dataUrl) map[r.assetId] = r.dataUrl; });
      setCustomFontUrls(map);
    });
    return () => { cancelled = true; };
  }, [diaryFontAssetId, customFonts]);

  useEffect(() => {
    let node = document.getElementById(DIARY_USER_FONT_STYLE_ID) as HTMLStyleElement | null;
    if (!node) {
      node = document.createElement("style");
      node.id = DIARY_USER_FONT_STYLE_ID;
      document.head.append(node);
    }
    const styleRules: string[] = [];
    if (diaryFontAssetId && customFontUrls[diaryFontAssetId]) {
      styleRules.push(`@font-face{font-family:"AIPhoneDiaryGlobalFont";src:url("${customFontUrls[diaryFontAssetId]}");font-display:swap;}`);
    }
    customFonts.forEach(f => {
      if (f.assetId && customFontUrls[f.assetId]) {
        styleRules.push(`@font-face{font-family:"AIPhoneDiaryFont_${f.id}";src:url("${customFontUrls[f.assetId]}");font-display:swap;}`);
      }
    });
    node.textContent = styleRules.join("\n");
  }, [diaryFontAssetId, customFonts, customFontUrls]);

  const handleDiaryFontUpload = useCallback(async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    try {
      const assetId = await saveThemeAssetFromBlob(file, "font");
      const dataUrl = await getThemeAssetDataUrl(assetId);
      if (!dataUrl) {
        throw new Error("字体资源没有保存成功");
      }
      const fontName = file.name.replace(/\.[^/.]+$/, "").slice(0, 16) || "自定义字体";
      const newFont: DiaryCustomFont = {
        id: `font_${Date.now()}`,
        name: fontName,
        assetId,
      };
      const nextFonts = [...customFonts, newFont];
      setCustomFonts(nextFonts);
      saveDiaryCustomFonts(nextFonts);
      setCustomFontUrls(prev => ({ ...prev, [assetId]: dataUrl }));
      notify(`已添加日记字体：${fontName}`);
    } catch (error) {
      notify("日记字体上传失败：" + String(error));
    }
  }, [customFonts, notify]);

  const handleDiaryFontScaleChange = useCallback((scale: number) => {
    const normalized = Math.min(1.25, Math.max(0.85, scale));
    setDiaryFontScale(normalized);
    saveDiaryEntryFontScale(normalized);
  }, []);

  const handleCharacterFontChange = useCallback((characterId: string, fontId: string) => {
    const nextMap = { ...characterFontMap, [characterId]: fontId };
    if (!fontId || fontId === "default") {
      delete nextMap[characterId];
    }
    setCharacterFontMap(nextMap);
    saveDiaryCharacterFontMap(nextMap);
  }, [characterFontMap]);

  const handleDeleteCustomFont = useCallback((fontId: string) => {
    const nextFonts = customFonts.filter(f => f.id !== fontId);
    setCustomFonts(nextFonts);
    saveDiaryCustomFonts(nextFonts);
    const nextMap = { ...characterFontMap };
    let changed = false;
    Object.entries(nextMap).forEach(([cId, fId]) => {
      if (fId === fontId) {
        delete nextMap[cId];
        changed = true;
      }
    });
    if (changed) {
      setCharacterFontMap(nextMap);
      saveDiaryCharacterFontMap(nextMap);
    }
    notify("已删除该字体");
  }, [customFonts, characterFontMap, notify]);

  const handleDiaryFontReset = useCallback(() => {
    saveDiaryEntryFontAssetId(null);
    saveDiaryEntryFontScale(1);
    saveDiaryCharacterFontMap({});
    setDiaryFontAssetId(null);
    setDiaryFontScale(1);
    setCharacterFontMap({});
    notify("已重置日记字体设置");
  }, [notify]);

  const getFontFamilyForCharacter = useCallback((characterId?: string): string => {
    const selectedFontId = characterId ? characterFontMap[characterId] : undefined;
    if (selectedFontId) {
      const preset = PRESET_DIARY_FONTS.find(p => p.id === selectedFontId);
      if (preset) return preset.family;
      const custom = customFonts.find(c => c.id === selectedFontId);
      if (custom && customFontUrls[custom.assetId]) {
        return `"AIPhoneDiaryFont_${custom.id}", "NoteWall Ximai", var(--app-font-family)`;
      }
    }
    if (diaryFontAssetId && customFontUrls[diaryFontAssetId]) {
      return '"AIPhoneDiaryGlobalFont", "NoteWall Ximai", var(--app-font-family)';
    }
    return '"NoteWall Ximai", var(--app-font-family)';
  }, [characterFontMap, customFonts, customFontUrls, diaryFontAssetId]);

  const activeCharacterFontFamily = useMemo(() => {
    return getFontFamilyForCharacter(activeCharacterId || undefined);
  }, [getFontFamilyForCharacter, activeCharacterId]);

  const diaryEntryStyle = useMemo(() => {
    return {
      "--diary-entry-font-family": activeCharacterFontFamily,
      "--diary-entry-font-scale": String(diaryFontScale),
    } as CSSProperties;
  }, [activeCharacterFontFamily, diaryFontScale]);

  const deleteEntry = useCallback((entry: DiaryEntry) => {
    deleteDiaryEntry(entry.id);
    setActiveEntry(current => current?.id === entry.id ? null : current);
    setDeleteCandidateEntry(current => current?.id === entry.id ? null : current);
    refreshEntries();
    notify(`已删除 ${entry.characterName} 的日记。`);
  }, [notify, refreshEntries]);

  useEffect(() => {
    setCharacters(loadCharacters());
    refreshEntries();
  }, [refreshEntries]);

  useEffect(() => {
    saveDiaryEntryTimerSettings(settings);
    window.dispatchEvent(new CustomEvent(DIARY_ENTRY_TIMER_SETTINGS_UPDATED_EVENT));
  }, [settings]);

  useEffect(() => {
    const handleEntriesUpdated = () => {
      refreshEntries();
      setSettings(loadDiaryEntryTimerSettings());
    };
    window.addEventListener(DIARY_ENTRIES_UPDATED_EVENT, handleEntriesUpdated);
    return () => window.removeEventListener(DIARY_ENTRIES_UPDATED_EVENT, handleEntriesUpdated);
  }, [refreshEntries]);

  const resolveTargets = useCallback((characterIds: string[]): Character[] => {
    const stored = loadCharacters();
    const uniqueIds = Array.from(new Set(characterIds.filter(Boolean)));
    return uniqueIds
      .map(characterId => characters.find(item => item.id === characterId) ?? stored.find(item => item.id === characterId))
      .filter(Boolean) as Character[];
  }, [characters]);

  const generateForCharacters = useCallback(async (characterIds: string[], trigger: DiaryEntryTrigger = "manual") => {
    const targets = resolveTargets(characterIds);
    if (targets.length === 0) {
      notify("找不到角色。");
      return;
    }

    const targetIds = targets.map(character => character.id);
    setGeneratingCharacterIds(prev => Array.from(new Set([...prev, ...targetIds])));
    try {
      const baseEntries = loadDiaryEntries();
      const results = await Promise.all(targets.map(async character => {
        try {
          return {
            status: "fulfilled" as const,
            character,
            draft: await generateDiaryEntryForCharacter(character.id, baseEntries, trigger),
          };
        } catch {
          return { status: "rejected" as const, character };
        }
      }));

      const createdEntries: DiaryEntry[] = [];
      const failedNames: string[] = [];
      for (const result of results) {
        if (result.status === "rejected") {
          failedNames.push(result.character.name);
          continue;
        }
        try {
          createdEntries.push(createDiaryEntry({
            characterId: result.character.id,
            characterName: result.character.name,
            title: result.draft.title,
            mood: result.draft.mood,
            weather: result.draft.weather,
            tags: result.draft.tags,
            body: result.draft.body,
            blocks: result.draft.blocks,
            trigger,
          }));
        } catch {
          failedNames.push(result.character.name);
        }
      }

      refreshEntries();
      if (createdEntries.length === 1 && failedNames.length === 0) {
        notify(`${createdEntries[0].characterName} 写了一篇日记。`);
      } else if (createdEntries.length > 0) {
        notify(`已生成 ${createdEntries.length} 篇日记${failedNames.length ? `，${failedNames.length} 个失败` : ""}。`);
      } else {
        notify(failedNames.length ? `日记生成失败：${failedNames.join("、")}` : "日记生成失败。");
      }
    } finally {
      setGeneratingCharacterIds(prev => prev.filter(id => !targetIds.includes(id)));
    }
  }, [notify, refreshEntries, resolveTargets]);

  const clearEntryDragTimer = useCallback(() => {
    const timer = entryDragRef.current?.timer;
    if (timer !== null && timer !== undefined) {
      window.clearTimeout(timer);
      if (entryDragRef.current) entryDragRef.current.timer = null;
    }
  }, []);

  const suppressEntryClick = useCallback((duration = 700) => {
    if (entryDragClickSuppressTimerRef.current !== null) {
      window.clearTimeout(entryDragClickSuppressTimerRef.current);
    }
    entryDragClickSuppressedRef.current = true;
    entryDragClickSuppressTimerRef.current = window.setTimeout(() => {
      entryDragClickSuppressedRef.current = false;
      entryDragClickSuppressTimerRef.current = null;
    }, duration);
  }, []);

  const lockEntryDragScroll = useCallback(() => {
    if (entryDragScrollLockRef.current || typeof document === "undefined") return;
    const main = entryMainRef.current;
    entryDragScrollLockRef.current = {
      bodyOverflow: document.body.style.overflow,
      bodyTouchAction: document.body.style.touchAction,
      htmlOverscrollBehavior: document.documentElement.style.overscrollBehavior,
      htmlTouchAction: document.documentElement.style.touchAction,
      main,
      mainOverflow: main?.style.overflow ?? "",
      mainTouchAction: main?.style.touchAction ?? "",
      mainScrollTop: main?.scrollTop ?? 0,
    };
    document.body.style.overflow = "hidden";
    document.body.style.touchAction = "none";
    document.documentElement.style.overscrollBehavior = "none";
    document.documentElement.style.touchAction = "none";
    if (!entryDragTouchMoveBlockerRef.current) {
      entryDragTouchMoveBlockerRef.current = (event: globalThis.TouchEvent) => {
        event.preventDefault();
      };
      document.addEventListener("touchmove", entryDragTouchMoveBlockerRef.current, { capture: true, passive: false });
    }
    if (main) {
      main.style.overflow = "hidden";
      main.style.touchAction = "none";
    }
  }, []);

  const unlockEntryDragScroll = useCallback(() => {
    const lock = entryDragScrollLockRef.current;
    if (!lock || typeof document === "undefined") return;
    document.body.style.overflow = lock.bodyOverflow;
    document.body.style.touchAction = lock.bodyTouchAction;
    document.documentElement.style.overscrollBehavior = lock.htmlOverscrollBehavior;
    document.documentElement.style.touchAction = lock.htmlTouchAction;
    if (entryDragTouchMoveBlockerRef.current) {
      document.removeEventListener("touchmove", entryDragTouchMoveBlockerRef.current, { capture: true });
      entryDragTouchMoveBlockerRef.current = null;
    }
    if (lock.main) {
      lock.main.style.overflow = lock.mainOverflow;
      lock.main.style.touchAction = lock.mainTouchAction;
      lock.main.scrollTop = lock.mainScrollTop;
    }
    entryDragScrollLockRef.current = null;
  }, []);

  const isEntryOverTrash = useCallback((clientX: number, clientY: number, width: number, height: number) => {
    const trashRect = entryTrashRef.current?.getBoundingClientRect();
    if (!trashRect) return false;
    const entryRect = {
      left: clientX - width / 2,
      right: clientX + width / 2,
      top: clientY - height / 2,
      bottom: clientY + height / 2,
    };
    return entryRect.left < trashRect.right
      && entryRect.right > trashRect.left
      && entryRect.top < trashRect.bottom
      && entryRect.bottom > trashRect.top;
  }, []);

  const resetEntryDrag = useCallback(() => {
    clearEntryDragTimer();
    const session = entryDragRef.current;
    if (session?.dragging) {
      suppressEntryClick();
    }
    if (session) {
      try {
        session.target.releasePointerCapture(session.pointerId);
      } catch {
        // Pointer capture may already be gone.
      }
    }
    entryDragRef.current = null;
    setEntryDrag(null);
    unlockEntryDragScroll();
  }, [clearEntryDragTimer, suppressEntryClick, unlockEntryDragScroll]);

  const updateEntryDragPosition = useCallback((clientX: number, clientY: number) => {
    const session = entryDragRef.current;
    if (!session?.dragging) return;
    const lock = entryDragScrollLockRef.current;
    if (lock?.main) lock.main.scrollTop = lock.mainScrollTop;
    const isOverTrash = isEntryOverTrash(clientX, clientY, session.width, session.height);
    setEntryDrag({
      entry: session.entry,
      x: clientX,
      y: clientY,
      width: session.width,
      height: session.height,
      isOverTrash,
    });
  }, [isEntryOverTrash]);

  const finishEntryDrag = useCallback((clientX: number, clientY: number) => {
    const session = entryDragRef.current;
    if (!session) return;
    const shouldDelete = session.dragging && isEntryOverTrash(clientX, clientY, session.width, session.height);
    const entry = session.entry;
    resetEntryDrag();
    if (shouldDelete) setDeleteCandidateEntry(entry);
  }, [isEntryOverTrash, resetEntryDrag]);

  useEffect(() => {
    if (!entryDrag) return;
    const handleWindowPointerMove = (event: globalThis.PointerEvent) => {
      const session = entryDragRef.current;
      if (!session?.dragging || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      updateEntryDragPosition(event.clientX, event.clientY);
    };
    const handleWindowPointerUp = (event: globalThis.PointerEvent) => {
      const session = entryDragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      event.preventDefault();
      finishEntryDrag(event.clientX, event.clientY);
    };
    const handleWindowPointerCancel = (event: globalThis.PointerEvent) => {
      const session = entryDragRef.current;
      if (!session || session.pointerId !== event.pointerId) return;
      resetEntryDrag();
    };
    window.addEventListener("pointermove", handleWindowPointerMove, { passive: false });
    window.addEventListener("pointerup", handleWindowPointerUp, { passive: false });
    window.addEventListener("pointercancel", handleWindowPointerCancel);
    return () => {
      window.removeEventListener("pointermove", handleWindowPointerMove);
      window.removeEventListener("pointerup", handleWindowPointerUp);
      window.removeEventListener("pointercancel", handleWindowPointerCancel);
    };
  }, [entryDrag, finishEntryDrag, resetEntryDrag, updateEntryDragPosition]);

  useEffect(() => {
    return () => {
      resetEntryDrag();
      unlockEntryDragScroll();
      if (entryDragClickSuppressTimerRef.current !== null) {
        window.clearTimeout(entryDragClickSuppressTimerRef.current);
        entryDragClickSuppressTimerRef.current = null;
      }
    };
  }, [resetEntryDrag, unlockEntryDragScroll]);

  const handleEntryPointerDown = useCallback((event: PointerEvent<HTMLButtonElement>, entry: DiaryEntry) => {
    if (!activeCharacterId) return;
    if (event.pointerType === "mouse" && event.button !== 0) return;
    clearEntryDragTimer();
    const rect = event.currentTarget.getBoundingClientRect();
    const target = event.currentTarget;
    entryDragRef.current = {
      entry,
      pointerId: event.pointerId,
      target,
      startX: event.clientX,
      startY: event.clientY,
      width: rect.width,
      height: rect.height,
      timer: window.setTimeout(() => {
        const session = entryDragRef.current;
        if (!session || session.pointerId !== event.pointerId || session.dragging) return;
        session.dragging = true;
        session.timer = null;
        suppressEntryClick(900);
        lockEntryDragScroll();
        try {
          session.target.setPointerCapture(session.pointerId);
        } catch {
          // Some touch browsers release capture during native gestures.
        }
        setEntryDrag({
          entry: session.entry,
          x: event.clientX,
          y: event.clientY,
          width: session.width,
          height: session.height,
          isOverTrash: isEntryOverTrash(event.clientX, event.clientY, session.width, session.height),
        });
      }, 430),
      dragging: false,
    };
  }, [activeCharacterId, clearEntryDragTimer, isEntryOverTrash, lockEntryDragScroll, suppressEntryClick]);

  const handleEntryPointerMove = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const session = entryDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    const dx = event.clientX - session.startX;
    const dy = event.clientY - session.startY;
    if (!session.dragging) {
      if (Math.hypot(dx, dy) > 8) {
        clearEntryDragTimer();
        entryDragRef.current = null;
      }
      return;
    }
    event.preventDefault();
    event.stopPropagation();
    updateEntryDragPosition(event.clientX, event.clientY);
  }, [clearEntryDragTimer, updateEntryDragPosition]);

  const handleEntryPointerUp = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const session = entryDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    event.preventDefault();
    event.stopPropagation();
    finishEntryDrag(event.clientX, event.clientY);
  }, [finishEntryDrag]);

  const handleEntryPointerCancel = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const session = entryDragRef.current;
    if (!session || session.pointerId !== event.pointerId) return;
    resetEntryDrag();
  }, [resetEntryDrag]);

  const handleEntryPointerLeave = useCallback((event: PointerEvent<HTMLButtonElement>) => {
    const session = entryDragRef.current;
    if (!session || session.pointerId !== event.pointerId || session.dragging) return;
    clearEntryDragTimer();
    entryDragRef.current = null;
  }, [clearEntryDragTimer]);

  const books = useMemo<DiaryBook[]>(() => {
    const map = new Map<string, DiaryEntry[]>();
    for (const entry of entries) {
      const list = map.get(entry.characterId);
      if (list) list.push(entry);
      else map.set(entry.characterId, [entry]);
    }
    return Array.from(map.entries()).map(([characterId, characterEntries]) => ({
      characterId,
      characterName: characterEntries[0].characterName,
      avatar: characters.find(character => character.id === characterId)?.avatar ?? "",
      entries: characterEntries,
    }));
  }, [entries, characters]);

  const activeBook = useMemo(
    () => (activeCharacterId ? books.find(book => book.characterId === activeCharacterId) ?? null : null),
    [activeCharacterId, books],
  );
  const activeBookBusy = Boolean(activeBook && generatingCharacterIds.includes(activeBook.characterId));

  return (
    <section className={`diary-app diary-entry-app ${entryDrag ? "is-entry-dragging" : ""}`} style={diaryEntryStyle}>
      {generatingCharacterIds.length > 0 && (
        <div className="diary-generating-toast" role="status">
          <span className="diary-generating-toast-spinner" aria-hidden="true" />
          正在生成日记{generatingCharacterIds.length > 1 ? `（${generatingCharacterIds.length} 篇）` : ""}…
        </div>
      )}
      <header className="diary-app-header diary-entry-header">
        <button
          type="button"
          className="diary-icon-btn"
          onClick={() => (activeBook ? setActiveCharacterId(null) : onBack())}
          aria-label="返回"
        >
          <ChevronLeft size={20} />
        </button>
        <div>
          <h1>{activeBook ? `${activeBook.characterName} 的日记` : "日记"}</h1>
          <p>{activeBook ? `共 ${activeBook.entries.length} 篇手写日常` : "每个角色一本，点开翻阅"}</p>
        </div>
        <input
          ref={fontFileRef}
          type="file"
          accept=".ttf,.otf,.woff,.woff2,font/*,application/font-woff,application/font-woff2"
          className="hidden"
          onChange={handleDiaryFontUpload}
        />
        <span className="diary-entry-header-actions">
          <button
            type="button"
            className="note-wall-menu-btn diary-font-upload-btn"
            onClick={() => setFontPanelOpen(true)}
            aria-label="日记字体设置"
            title="日记字体设置"
          >
            <span className="diary-font-upload-mark" aria-hidden="true">Aa</span>
          </button>
          <button type="button" className="note-wall-menu-btn" onClick={() => setTimerSettingsOpen(true)} aria-label="日记设置">
            <DotsThree size={28} weight="bold" />
          </button>
        </span>
      </header>

      <main ref={entryMainRef} className="diary-entry-main">
        {entries.length === 0 ? (
          <div className="diary-entry-empty">
            <NotebookPen size={34} strokeWidth={1.5} />
            <h2>还没有日记</h2>
            <p>让角色先写一篇，纸面会从这里开始铺开。</p>
            <button type="button" onClick={() => setWritePanelOpen(true)}>让TA写一篇</button>
          </div>
        ) : activeBook ? (
          <div className="diary-entry-list">
            {activeBook.entries.map(entry => (
              <DiaryEntryCard
                key={entry.id}
                entry={entry}
                isDragSource={entryDrag?.entry.id === entry.id}
                onPointerDown={(event) => handleEntryPointerDown(event, entry)}
                onPointerMove={handleEntryPointerMove}
                onPointerUp={handleEntryPointerUp}
                onPointerCancel={handleEntryPointerCancel}
                onPointerLeave={handleEntryPointerLeave}
                onClick={(event) => {
                  event.stopPropagation();
                  if (entryDragClickSuppressedRef.current) {
                    event.preventDefault();
                    return;
                  }
                  setActiveEntry(entry);
                }}
              />
            ))}
          </div>
        ) : (
          <div className="diary-shelf">
            {[0, 1].map(column => (
              <div className="diary-shelf-column" key={column}>
                {books.filter((_, index) => index % 2 === column).map(book => (
                  <DiaryBookCover
                    key={book.characterId}
                    book={book}
                    busy={generatingCharacterIds.includes(book.characterId)}
                    fontFamily={getFontFamilyForCharacter(book.characterId)}
                    onOpen={() => setActiveCharacterId(book.characterId)}
                  />
                ))}
              </div>
            ))}
          </div>
        )}
      </main>

      {entries.length > 0 ? (
        activeBook ? (
          <button
            type="button"
            className="diary-entry-write-btn"
            disabled={activeBookBusy}
            aria-busy={activeBookBusy}
            onClick={() => generateForCharacters([activeBook.characterId])}
          >
            <WandSparkles size={18} strokeWidth={1.7} />
            {activeBookBusy ? <DiaryWritingStatus /> : <span>让TA写</span>}
          </button>
        ) : (
          <button type="button" className="diary-entry-write-btn" onClick={() => setWritePanelOpen(true)}>
            <WandSparkles size={18} strokeWidth={1.7} />
            <span>让TA写</span>
          </button>
        )
      ) : null}

      {timerSettingsOpen ? (
        <DiaryEntryTimerSettingsPanel
          characters={characters}
          settings={settings}
          generatingCharacterIds={generatingCharacterIds}
          onChange={setSettings}
          onClose={() => setTimerSettingsOpen(false)}
        />
      ) : null}

      {writePanelOpen ? (
        <DiaryEntryWritePanel
          characters={characters}
          generatingCharacterIds={generatingCharacterIds}
          onGenerateMany={generateForCharacters}
          onClose={() => setWritePanelOpen(false)}
        />
      ) : null}

      {fontPanelOpen ? (
        <DiaryEntryFontPanel
          characters={characters}
          characterFontMap={characterFontMap}
          customFonts={customFonts}
          scale={diaryFontScale}
          onUpload={() => fontFileRef.current?.click()}
          onScaleChange={handleDiaryFontScaleChange}
          onCharacterFontChange={handleCharacterFontChange}
          onDeleteCustomFont={handleDeleteCustomFont}
          onReset={handleDiaryFontReset}
          onClose={() => setFontPanelOpen(false)}
        />
      ) : null}

      {activeEntry ? (
        <DiaryEntryDetail
          entry={activeEntry}
          fontFamily={getFontFamilyForCharacter(activeEntry.characterId)}
          onClose={() => setActiveEntry(null)}
        />
      ) : null}

      {deleteCandidateEntry ? (
        <div
          className="nw-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="diary-entry-delete-title"
          onClick={() => setDeleteCandidateEntry(null)}
        >
          <section className="nw-delete-confirm" onClick={event => event.stopPropagation()}>
            <div className="nw-delete-confirm-icon">
              <Trash2 size={24} strokeWidth={1.8} />
            </div>
            <h2 id="diary-entry-delete-title">删除日记</h2>
            <p>这篇日记会被删除，对应的短期记忆事件也会消失。</p>
            <div>
              <button type="button" className="nw-secondary-btn" onClick={() => setDeleteCandidateEntry(null)}>取消</button>
              <button type="button" className="nw-danger-btn" onClick={() => deleteEntry(deleteCandidateEntry)}>
                <span className="note-wall-primary-content">
                  <span>删除</span>
                </span>
              </button>
            </div>
          </section>
        </div>
      ) : null}

      <div
        ref={entryTrashRef}
        className={`diary-entry-trash-bin ${entryDrag ? "is-visible" : ""} ${entryDrag?.isOverTrash ? "is-over" : ""}`}
        aria-hidden={!entryDrag}
      >
        <Trash2 size={30} strokeWidth={1.8} />
      </div>

      {entryDrag ? (
        <div
          className="diary-entry-card diary-entry-drag-ghost"
          style={{
            left: entryDrag.x,
            top: entryDrag.y,
            width: entryDrag.width,
            minHeight: entryDrag.height,
          }}
        >
          <DiaryEntryCardContent entry={entryDrag.entry} />
        </div>
      ) : null}
    </section>
  );
}

const DIARY_BOOK_COVER_COUNT = 6;

function hashText(value: string): number {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash;
}

function DiaryBookCover({ book, busy, fontFamily, onOpen }: {
  book: DiaryBook;
  busy: boolean;
  fontFamily?: string;
  onOpen: () => void;
}) {
  const hash = hashText(book.characterId);
  const latest = book.entries[0];
  const coverStyle = fontFamily ? ({ "--diary-entry-font-family": fontFamily } as CSSProperties) : undefined;
  return (
    <button
      type="button"
      className="diary-book"
      style={coverStyle}
      data-cover={hash % DIARY_BOOK_COVER_COUNT}
      onClick={onOpen}
    >
      <span className="diary-book-spine" aria-hidden="true" />
      <span className="diary-book-frame" aria-hidden="true" />
      <span className="diary-book-label">
        <span className="diary-book-avatar">
          {book.avatar ? <img src={book.avatar} alt="" /> : <Bot size={20} />}
        </span>
        <strong>{book.characterName}</strong>
        <em>{busy ? <DiaryWritingStatus /> : "的日记本"}</em>
      </span>
      <span className="diary-book-meta">
        <span>{book.entries.length} 篇</span>
        <time>{formatEntryTime(latest.createdAt)}</time>
      </span>
    </button>
  );
}

function DiaryEntryCardContent({ entry }: { entry: DiaryEntry }) {
  const preview = entry.blocks.map(blockPlainText).filter(Boolean).join(" ");
  const markers = getEntryMarkers(entry);
  return (
    <>
      <span className="diary-entry-card-kicker">DIARY</span>
      {markers.length > 0 ? (
        <span className="diary-entry-card-markers">
          {markers.map(marker => <span key={marker} className="diary-entry-marker">{marker}</span>)}
        </span>
      ) : null}
      <strong>{entry.title}</strong>
      <span className="diary-entry-card-text">{clipText(preview || entry.body, 130)}</span>
      <span className="diary-entry-card-meta">
        <span>{entry.characterName}</span>
        <time>{formatEntryTime(entry.createdAt)}</time>
      </span>
    </>
  );
}

function DiaryEntryCard({
  entry,
  isDragSource,
  onClick,
  onPointerDown,
  onPointerMove,
  onPointerUp,
  onPointerCancel,
  onPointerLeave,
}: {
  entry: DiaryEntry;
  isDragSource: boolean;
  onClick: (event: MouseEvent<HTMLButtonElement>) => void;
  onPointerDown: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerMove: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerCancel: (event: PointerEvent<HTMLButtonElement>) => void;
  onPointerLeave: (event: PointerEvent<HTMLButtonElement>) => void;
}) {
  return (
    <button
      type="button"
      className={`diary-entry-card ${isDragSource ? "is-drag-source" : ""}`}
      draggable={false}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerCancel}
      onPointerLeave={onPointerLeave}
      onContextMenu={event => event.preventDefault()}
      onClick={onClick}
    >
      <DiaryEntryCardContent entry={entry} />
    </button>
  );
}

function DiaryEntryFontPanel({
  characters,
  characterFontMap,
  customFonts,
  scale,
  onUpload,
  onScaleChange,
  onCharacterFontChange,
  onDeleteCustomFont,
  onReset,
  onClose,
}: {
  characters: Character[];
  characterFontMap: Record<string, string>;
  customFonts: DiaryCustomFont[];
  scale: number;
  onUpload: () => void;
  onScaleChange: (scale: number) => void;
  onCharacterFontChange: (characterId: string, fontId: string) => void;
  onDeleteCustomFont: (fontId: string) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [tab, setTab] = useState<"character" | "manage">("character");

  const allFontOptions = useMemo(() => {
    const options: { id: string; name: string }[] = [
      { id: "default", name: "默认喜脉手写" },
      ...PRESET_DIARY_FONTS.map(p => ({ id: p.id, name: p.name })),
      ...customFonts.map(c => ({ id: c.id, name: `${c.name} (自定义)` })),
    ];
    return options;
  }, [customFonts]);

  return (
    <div className="nw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="diary-font-panel" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h2>日记字体设置</h2>
            <p>为每个角色挑选专属手写字体</p>
          </div>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="diary-font-tabs">
          <button
            type="button"
            className={`diary-font-tab-btn ${tab === "character" ? "is-active" : ""}`}
            onClick={() => setTab("character")}
          >
            角色字体分配
          </button>
          <button
            type="button"
            className={`diary-font-tab-btn ${tab === "manage" ? "is-active" : ""}`}
            onClick={() => setTab("manage")}
          >
            字体库与字号
          </button>
        </div>

        {tab === "character" ? (
          <div className="diary-font-character-list">
            {characters.length === 0 ? (
              <p style={{ textAlign: "center", color: "rgba(48,45,40,0.5)", margin: "20px 0", fontSize: "13px" }}>暂无角色</p>
            ) : (
              characters.map(character => (
                <div key={character.id} className="diary-font-character-item">
                  <div className="diary-font-character-info">
                    <div className="diary-font-character-avatar">
                      {character.avatar ? <img src={character.avatar} alt="" /> : <Bot size={16} />}
                    </div>
                    <span className="diary-font-character-name">{character.name}</span>
                  </div>
                  <select
                    className="diary-font-select"
                    value={characterFontMap[character.id] || "default"}
                    onChange={e => onCharacterFontChange(character.id, e.target.value)}
                  >
                    {allFontOptions.map(opt => (
                      <option key={opt.id} value={opt.id}>{opt.name}</option>
                    ))}
                  </select>
                </div>
              ))
            )}
          </div>
        ) : (
          <div>
            <button type="button" className="diary-font-upload-action" onClick={onUpload}>
              <span className="diary-font-upload-mark" aria-hidden="true">Aa</span>
              <span>上传新字体文件 (.ttf/.woff2)</span>
            </button>

            {customFonts.length > 0 && (
              <div style={{ marginTop: "12px" }}>
                <div style={{ fontSize: "12px", fontWeight: 600, color: "rgba(48,45,40,0.7)", marginBottom: "6px" }}>已上传字体：</div>
                {customFonts.map(font => (
                  <div key={font.id} className="diary-font-custom-item">
                    <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{font.name}</span>
                    <button
                      type="button"
                      className="diary-font-delete-btn"
                      title="删除字体"
                      onClick={() => onDeleteCustomFont(font.id)}
                    >
                      <Trash2 size={15} />
                    </button>
                  </div>
                ))}
              </div>
            )}

            <label className="diary-font-size-control">
              <span>
                <strong>日记全局字号</strong>
                <em>{Math.round(scale * 100)}%</em>
              </span>
              <input
                type="range"
                min="0.85"
                max="1.25"
                step="any"
                value={scale}
                onChange={event => onScaleChange(Number(event.target.value))}
              />
            </label>

            <button type="button" className="diary-font-reset-btn" onClick={onReset}>
              重置所有字体设置
            </button>
          </div>
        )}
      </section>
    </div>
  );
}

function DiaryEntryTimerSettingsPanel({ characters, settings, generatingCharacterIds, onChange, onClose }: {
  characters: Character[];
  settings: DiaryEntryTimerSettings;
  generatingCharacterIds: string[];
  onChange: (settings: DiaryEntryTimerSettings) => void;
  onClose: () => void;
}) {
  const busy = generatingCharacterIds.length > 0;

  const toggleTimerCharacter = (characterId: string) => {
    onChange({
      ...settings,
      characterIds: settings.characterIds.includes(characterId)
        ? settings.characterIds.filter(id => id !== characterId)
        : [...settings.characterIds, characterId],
    });
  };

  return (
    <div className="nw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="diary-entry-settings" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h2>定时写日记</h2>
            <p>默认一天一次；未选择角色时，会按全部角色处理。</p>
          </div>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <div className="diary-entry-setting-grid">
          <label className="diary-entry-toggle-row">
            <span>
              <Clock3 size={17} />
              定时写日记
            </span>
            <input
              type="checkbox"
              checked={settings.enabled}
              onChange={event => onChange({ ...settings, enabled: event.target.checked })}
            />
          </label>
          <label className="diary-entry-number-field">
            <span>间隔小时</span>
            <input
              type="number"
              min={1}
              max={720}
              value={settings.intervalHours}
              onChange={event => onChange({ ...settings, intervalHours: Math.max(1, Math.min(720, Number(event.target.value) || 24)) })}
            />
          </label>
        </div>

        <section className="diary-entry-character-section">
          <div className="diary-entry-section-title">
            <strong>定时角色</strong>
            <span>{settings.characterIds.length ? `已选 ${settings.characterIds.length} 个` : "默认全部"}</span>
          </div>
          <CharacterAvatarGrid
            characters={characters}
            selectedIds={settings.characterIds}
            busyIds={generatingCharacterIds}
            disabled={busy}
            onToggle={toggleTimerCharacter}
          />
        </section>
      </section>
    </div>
  );
}

function DiaryEntryWritePanel({ characters, generatingCharacterIds, onGenerateMany, onClose }: {
  characters: Character[];
  generatingCharacterIds: string[];
  onGenerateMany: (characterIds: string[], trigger?: DiaryEntryTrigger) => Promise<void> | void;
  onClose: () => void;
}) {
  const [selectedImmediateIds, setSelectedImmediateIds] = useState<string[]>([]);
  const [confirming, setConfirming] = useState(false);
  const busy = confirming || generatingCharacterIds.length > 0;

  const toggleImmediateCharacter = (characterId: string) => {
    setSelectedImmediateIds(prev => prev.includes(characterId)
      ? prev.filter(id => id !== characterId)
      : [...prev, characterId]);
  };

  const handleConfirm = async () => {
    if (busy || selectedImmediateIds.length === 0) return;
    setConfirming(true);
    try {
      await onGenerateMany(selectedImmediateIds, "manual");
      setSelectedImmediateIds([]);
    } finally {
      setConfirming(false);
    }
  };

  return (
    <div className="nw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <section className="diary-entry-settings diary-entry-write-panel" onClick={event => event.stopPropagation()}>
        <header>
          <div>
            <h2>让TA写一篇</h2>
            <p>选择角色后确认，会并行生成日记。</p>
          </div>
          <button type="button" className="diary-icon-btn" onClick={onClose} aria-label="关闭">
            <X size={18} />
          </button>
        </header>

        <CharacterAvatarGrid
          characters={characters}
          selectedIds={selectedImmediateIds}
          busyIds={generatingCharacterIds}
          disabled={busy}
          onToggle={toggleImmediateCharacter}
        />
        {selectedImmediateIds.length > 0 ? (
          <button
            type="button"
            className={`diary-entry-confirm-btn ${confirming ? "is-loading" : ""}`}
            disabled={busy}
            onClick={handleConfirm}
            aria-busy={confirming}
          >
            <span className="note-wall-primary-content">
              {confirming ? <span className="note-wall-primary-spinner" aria-hidden="true" /> : null}
              <span>{confirming ? <DiaryWritingStatus /> : `确认让 ${selectedImmediateIds.length} 个角色写日记`}</span>
            </span>
          </button>
        ) : null}
      </section>
    </div>
  );
}

function CharacterAvatarGrid({ characters, selectedIds, busyIds, disabled, onToggle }: {
  characters: Character[];
  selectedIds: string[];
  busyIds: string[];
  disabled: boolean;
  onToggle: (characterId: string) => void;
}) {
  if (characters.length === 0) return <p className="diary-entry-empty-line">暂无角色。</p>;

  return (
    <div className="diary-entry-character-grid">
      {characters.map(character => {
        const selected = selectedIds.includes(character.id);
        const busy = busyIds.includes(character.id);
        return (
          <button
            key={character.id}
            type="button"
            className={selected ? "is-selected" : ""}
            disabled={disabled}
            aria-pressed={selected}
            onClick={() => onToggle(character.id)}
          >
            <span>
              {character.avatar ? <img src={character.avatar} alt="" /> : <Bot size={18} />}
            </span>
            <strong>{character.name}</strong>
            {busy ? <em><DiaryWritingStatus /></em> : null}
          </button>
        );
      })}
    </div>
  );
}

function DiaryEntryDetail({
  entry,
  fontFamily,
  onClose,
}: {
  entry: DiaryEntry;
  fontFamily?: string;
  onClose: () => void;
}) {
  const markers = getEntryMarkers(entry);
  const detailPaperStyle = fontFamily ? ({ "--diary-entry-font-family": fontFamily } as CSSProperties) : undefined;
  return (
    <div className="nw-modal-backdrop" role="dialog" aria-modal="true" onClick={onClose}>
      <article className="diary-entry-detail-paper" style={detailPaperStyle} onClick={(event) => event.stopPropagation()}>
        <span className="diary-entry-paper-clip" aria-hidden="true">
          <span />
        </span>
        <div className="diary-entry-detail-scroll">
          <header>
            <div>
              <span>日记详情</span>
              <h2>{entry.title}</h2>
            </div>
            <div className="diary-entry-detail-top">
              <button type="button" onClick={onClose}>关闭</button>
              {markers.length > 0 ? (
                <span className="diary-entry-detail-markers">
                  {markers.map(marker => <span key={marker} className="diary-entry-marker">{marker}</span>)}
                </span>
              ) : null}
            </div>
          </header>
          <div className="diary-entry-blocks">
            {entry.blocks.map((block, index) => (
              <DiaryBlockView key={`${block.type}-${index}`} block={block} />
            ))}
          </div>
          <footer className="diary-entry-detail-signature">
            <span>{entry.characterName}</span>
            <time>{formatEntryTime(entry.createdAt)}</time>
          </footer>
        </div>
      </article>
    </div>
  );
}

function DiaryBlockView({ block }: { block: DiaryEntryBlock }) {
  if (block.type === "quote") {
    return <blockquote className="diary-entry-quote">{block.text}</blockquote>;
  }
  if (block.type === "correction") {
    return (
      <p className="diary-entry-correction">
        <del>{block.text}</del>
        {block.replacement ? <ins>{block.replacement}</ins> : null}
      </p>
    );
  }
  if (block.type === "todo") {
    return (
      <section className="diary-entry-todo">
        {block.title ? <h3>{block.title}</h3> : null}
        <ul>
          {block.items.map((item, index) => (
            <li key={`${item.text}-${index}`} data-done={item.done ? "true" : "false"}>
              <span />
              <p>{item.text}</p>
            </li>
          ))}
        </ul>
      </section>
    );
  }
  if (block.type === "image") {
    return (
      <figure className="diary-entry-image-block">
        <div>{block.description}</div>
        {block.caption ? <figcaption>{block.caption}</figcaption> : null}
      </figure>
    );
  }
  return <p className="diary-entry-paragraph">{block.text}</p>;
}

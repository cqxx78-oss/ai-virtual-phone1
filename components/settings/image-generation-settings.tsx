"use client";

import { useCallback, useEffect, useMemo, useRef, useState, useContext, type CSSProperties } from "react";
import { AlertCircle, Camera, Check, ChevronDown, FileEdit, Image as ImageIcon, Plus, RefreshCw, Sparkles, Trash2, Upload, X } from "lucide-react";
import { SettingsContext } from "../phone-settings-app";
import type { ImageGenerationProfile, ImageGenerationSettings as ImageGenerationSettingsType } from "@/lib/settings-types";
import {
    DEFAULT_IMAGE_GENERATION_SETTINGS,
    loadImageGenerationSettings,
    saveImageGenerationSettings,
} from "@/lib/settings-storage";
import { loadCharacters } from "@/lib/character-storage";
import type { Character } from "@/lib/character-types";
import { getChatImageFromIndexedDB, saveChatImageToIndexedDB } from "@/lib/chat-asset-storage";
import {
    fetchImageGenerationModels,
    filterLikelyImageModels,
    generateImageFromConfiguredApi,
} from "@/lib/image-generation-service";
import { Alert } from "@/components/ui/feedback";
import { ConfirmDialog } from "@/components/ui/modal";
import { Input, Select, Textarea, Toggle } from "@/components/ui/form";

const PORTRAIT_SIZE_PRESETS = [
    { value: "auto", label: "auto" },
    // 1K
    { value: "1024x1024", label: "1024×1024 (1K, 1:1)" },
    { value: "1024x1536", label: "1024×1536 (1K, 2:3)" },
    { value: "864x1536", label: "864×1536 (1K, 9:16)" },
    // 2K
    { value: "2048x2048", label: "2048×2048 (2K, 1:1)" },
    { value: "1280x1920", label: "1280×1920 (2K, 2:3)" },
    { value: "1080x1920", label: "1080×1920 (2K, 9:16)" },
    // 4K
    { value: "2732x2732", label: "2732×2732 (4K, 1:1)" },
    { value: "1712x2560", label: "1712×2560 (4K, 2:3)" },
    { value: "2304x4096", label: "2304×4096 (4K, 9:16)" },
] as const;

const LANDSCAPE_SIZE_PRESETS = [
    // 1K
    { value: "1024x1024", label: "1024×1024 (1K, 1:1)" },
    { value: "1536x1024", label: "1536×1024 (1K, 3:2)" },
    { value: "1536x864", label: "1536×864 (1K, 16:9)" },
    // 2K
    { value: "2048x2048", label: "2048×2048 (2K, 1:1)" },
    { value: "1920x1280", label: "1920×1280 (2K, 3:2)" },
    { value: "1920x1080", label: "1920×1080 (2K, 16:9)" },
    // 4K
    { value: "2732x2732", label: "2732×2732 (4K, 1:1)" },
    { value: "2560x1712", label: "2560×1712 (4K, 3:2)" },
    { value: "4096x2304", label: "4096×2304 (4K, 16:9)" },
] as const;

const ALL_SIZE_PRESET_ITEMS = [...PORTRAIT_SIZE_PRESETS, ...LANDSCAPE_SIZE_PRESETS];
const SIZE_PRESETS = Array.from(new Set(ALL_SIZE_PRESET_ITEMS.map(i => i.value)));
const SIZE_LABEL_MAP: Record<string, string> = Object.fromEntries(ALL_SIZE_PRESET_ITEMS.map(i => [i.value, i.label]));
const QUALITY_OPTIONS = ["auto", "low", "medium", "high"];

/** 判断是否为自定义尺寸 */
function isCustomSize(size: string): boolean {
    return size !== "custom" && !(SIZE_PRESETS as readonly string[]).includes(size);
}

/** 从 "WxH" 解析宽高 */
function parseCustomSize(size: string): { w: string; h: string } | null {
    const match = /^(\d+)[xX×](\d+)$/.exec(size.trim());
    if (!match) return null;
    return { w: match[1], h: match[2] };
}

function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

const RATIO_HINT_MARKER = "【画面比例】";
const SIZE_RATIO_HINTS: Record<string, string> = {
    "1024x1024": "正方形 1:1 构图，square 1:1 composition",
    "1024x1536": "竖向 2:3 构图，vertical portrait composition",
    "864x1536": "竖向 9:16 构图，vertical portrait 9:16 composition",
    "1536x1024": "横向 3:2 构图，horizontal landscape composition",
    "1536x864": "横向 16:9 构图，horizontal landscape 16:9 composition",
    "2048x2048": "正方形 1:1 构图，square 1:1 composition",
    "1280x1920": "竖向 2:3 构图，vertical portrait composition",
    "1080x1920": "竖向 9:16 构图，vertical portrait 9:16 composition",
    "1920x1280": "横向 3:2 构图，horizontal landscape composition",
    "1920x1080": "横向 16:9 构图，horizontal landscape 16:9 composition",
    "2732x2732": "正方形 1:1 构图，square 1:1 composition",
    "1712x2560": "竖向 2:3 构图，vertical portrait composition",
    "2304x4096": "竖向 9:16 构图，vertical portrait 9:16 composition",
    "2560x1712": "横向 3:2 构图，horizontal landscape composition",
    "4096x2304": "横向 16:9 构图，horizontal landscape 16:9 composition",
};

function ratioHintForSize(size: string): string | undefined {
    if (SIZE_RATIO_HINTS[size]) return SIZE_RATIO_HINTS[size];
    const parsed = parseCustomSize(size);
    if (!parsed) return undefined;
    const w = Number(parsed.w);
    const h = Number(parsed.h);
    if (!w || !h) return undefined;
    const g = greatestCommonDivisor(w, h);
    const rw = w / g;
    const rh = h / g;
    if (rw === rh) return "正方形 1:1 构图，square 1:1 composition";
    if (rw === 2 && rh === 3) return "竖向 2:3 构图，vertical portrait composition";
    if (rw === 3 && rh === 2) return "横向 3:2 构图，horizontal landscape composition";
    if (rw > rh) return `${rw}:${rh} 构图，landscape ${rw}:${rh} composition`;
    return `${rw}:${rh} 构图，portrait ${rw}:${rh} composition`;
}

function stripRatioHint(text: string): string {
    return text.replace(new RegExp(`\\s*${RATIO_HINT_MARKER}[^\\n]*`, "g"), "").replace(/\s+$/, "");
}

function withRatioHint(extraPrompt: string, size: string): string {
    const base = stripRatioHint(extraPrompt);
    const hint = ratioHintForSize(size);
    if (!hint) return base;
    return base ? `${base}\n${RATIO_HINT_MARKER}${hint}` : `${RATIO_HINT_MARKER}${hint}`;
}

const IMAGE_HOSTING_PROVIDER_OPTIONS = [
    { value: "none", label: "不使用图床" },
    { value: "imgbb", label: "ImgBB" },
] as const;

const imageGenerationIconStyle = { "--icon-color": "#0EA5E9" } as CSSProperties;

type Status = { success: boolean; message: string };

export function ImageGenerationSettings() {
    const { setSubpageRightAction, setOverrideBack } = useContext(SettingsContext);
    const [settings, setSettings] = useState<ImageGenerationSettingsType>(DEFAULT_IMAGE_GENERATION_SETTINGS);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewProfile, setIsNewProfile] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

    const [characters, setCharacters] = useState<Character[]>([]);
    const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
    
    // Testing & Fetching states
    const [isFetchingModels, setIsFetchingModels] = useState<Record<string, boolean>>({});
    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
    const [isTesting, setIsTesting] = useState<Record<string, boolean>>({});
    const [status, setStatus] = useState<Record<string, Status | null>>({});
    const [testPreviewUrl, setTestPreviewUrl] = useState<Record<string, string | null>>({});
    
    const [customW, setCustomW] = useState("2048");
    const [customH, setCustomH] = useState("2048");
    const lastCustomSize = useRef("2048x2048");
    const [sizeTab, setSizeTab] = useState<"default" | "landscape">("default");

    useEffect(() => {
        const loaded = loadImageGenerationSettings();
        setSettings(loaded);
        setCharacters(loadCharacters());
    }, []);

    const profiles = useMemo(() => {
        return settings.profiles && settings.profiles.length > 0
            ? settings.profiles
            : [{
                id: "img-profile-default",
                name: "默认生图方案",
                requestMode: settings.requestMode,
                apiKey: settings.apiKey,
                baseUrl: settings.baseUrl,
                model: settings.model,
                size: settings.size,
                quality: settings.quality,
                extraPrompt: settings.extraPrompt,
            }];
    }, [settings]);

    const [selectedGroup, setSelectedGroup] = useState<string>("全部");

    const allGroups = useMemo(() => {
        const groups = new Set<string>();
        (profiles || []).forEach(p => {
            const g = (p?.group || "").trim();
            if (g) groups.add(g);
            else groups.add("默认");
        });
        return ["全部", ...Array.from(groups)];
    }, [profiles]);

    const displayedProfiles = useMemo(() => {
        if (!Array.isArray(profiles)) return [];
        if (selectedGroup === "全部") return profiles;
        return profiles.filter(p => {
            const g = (p?.group || "").trim() || "默认";
            return g === selectedGroup;
        });
    }, [profiles, selectedGroup]);

    const activeProfileId = settings.activeProfileId || profiles[0]?.id || "img-profile-default";
    const editingProfile = useMemo(() => {
        if (!editingId) return null;
        return profiles.find(p => p.id === editingId) || null;
    }, [editingId, profiles]);

    // 同步自定义宽高
    useEffect(() => {
        if (!editingProfile) return;
        if (!isCustomSize(editingProfile.size)) return;
        const parsed = parseCustomSize(editingProfile.size);
        if (!parsed) return;
        lastCustomSize.current = `${parsed.w}x${parsed.h}`;
        setCustomW(parsed.w);
        setCustomH(parsed.h);
    }, [editingProfile?.size]);

    useEffect(() => {
        let cancelled = false;
        const refs = settings.characterReferences || {};
        Promise.all(Object.entries(refs).map(async ([characterId, ref]) => {
            const dataUrl = ref.assetId ? await getChatImageFromIndexedDB(ref.assetId) : null;
            return [characterId, dataUrl] as const;
        })).then(entries => {
            if (cancelled) return;
            const next: Record<string, string> = {};
            for (const [characterId, dataUrl] of entries) {
                if (dataUrl) next[characterId] = dataUrl;
            }
            setReferencePreviews(next);
        });
        return () => { cancelled = true; };
    }, [settings.characterReferences]);

    useEffect(() => {
        return () => {
            Object.values(testPreviewUrl).forEach(url => {
                if (url) URL.revokeObjectURL(url);
            });
        };
    }, [testPreviewUrl]);

    const persist = useCallback((next: ImageGenerationSettingsType) => {
        setSettings(next);
        saveImageGenerationSettings(next);
    }, []);

    // 拖拽排序逻辑
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragPos, setDragPos] = useState<{ x: number; y: number } | null>(null);
    const touchStateRef = useRef<{
        id: string;
        startX: number;
        startY: number;
        grabOffsetX: number;
        grabOffsetY: number;
        width: number;
        height: number;
        activated: boolean;
    } | null>(null);
    const draggingIdRef = useRef<string | null>(null);
    const isTouchDragRef = useRef(false);
    const autoScrollRafRef = useRef<number | null>(null);
    const latestClientYRef = useRef<number>(0);

    // 全局指针事件(同时支持触屏 + 鼠标拖拽)
    useEffect(() => {
        const onMove = (clientX: number, clientY: number) => {
            const state = touchStateRef.current;
            if (!state || !state.activated) return;

            const dx = clientX - state.startX;
            const dy = clientY - state.startY;
            const dist = Math.hypot(dx, dy);

            // 长按未激活前,移动超过阈值就取消,允许正常滚动
            if (!isTouchDragRef.current && dist > 10) {
                state.activated = false;
                touchStateRef.current = null;
                return;
            }

            if (isTouchDragRef.current) {
                latestClientYRef.current = clientY;
                setDragPos({ x: clientX - state.grabOffsetX, y: clientY - state.grabOffsetY });

                // 边缘自动滚动检测
                const viewportHeight = window.innerHeight;
                const scrollZone = 90;
                const scrollContainer = document.querySelector(".page-body") as HTMLElement || document.scrollingElement || document.documentElement;

                const checkAutoScroll = () => {
                    if (!isTouchDragRef.current) {
                        if (autoScrollRafRef.current) cancelAnimationFrame(autoScrollRafRef.current);
                        autoScrollRafRef.current = null;
                        return;
                    }
                    const currentY = latestClientYRef.current;
                    if (currentY > viewportHeight - scrollZone) {
                        const intensity = Math.min(1, (currentY - (viewportHeight - scrollZone)) / scrollZone);
                        scrollContainer.scrollTop += intensity * 16;
                    } else if (currentY < scrollZone) {
                        const intensity = Math.min(1, (scrollZone - currentY) / scrollZone);
                        scrollContainer.scrollTop -= intensity * 16;
                    }
                    autoScrollRafRef.current = requestAnimationFrame(checkAutoScroll);
                };

                if (!autoScrollRafRef.current && (clientY > viewportHeight - scrollZone || clientY < scrollZone)) {
                    autoScrollRafRef.current = requestAnimationFrame(checkAutoScroll);
                } else if (autoScrollRafRef.current && clientY >= scrollZone && clientY <= viewportHeight - scrollZone) {
                    cancelAnimationFrame(autoScrollRafRef.current);
                    autoScrollRafRef.current = null;
                }

                // 隐藏被拖拽的浮层，以精确探测下方真实的卡槽位置
                const ghostEl = document.getElementById("image-drag-ghost");
                if (ghostEl) ghostEl.style.pointerEvents = "none";
                const targetEl = document.elementFromPoint(clientX, clientY);

                const cardEl = targetEl?.closest("[data-profile-id]") as HTMLElement | null;
                if (cardEl && draggingIdRef.current) {
                    const hoverId = cardEl.getAttribute("data-profile-id");
                    if (hoverId && hoverId !== draggingIdRef.current) {
                        setSettings(prev => {
                            const currProfiles = prev.profiles && prev.profiles.length > 0 ? prev.profiles : profiles;
                            const fromIdx = currProfiles.findIndex(p => p.id === draggingIdRef.current);
                            const toIdx = currProfiles.findIndex(p => p.id === hoverId);
                            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
                            const nextProfiles = [...currProfiles];
                            const [item] = nextProfiles.splice(fromIdx, 1);
                            nextProfiles.splice(toIdx, 0, item);
                            const nextSettings = { ...prev, profiles: nextProfiles };
                            saveImageGenerationSettings(nextSettings);
                            return nextSettings;
                        });
                        if (navigator.vibrate) navigator.vibrate(15);
                    }
                }
            }
        };

        const onTouchMove = (e: TouchEvent) => {
            if (isTouchDragRef.current) {
                e.preventDefault();
            }
            const touch = e.touches[0];
            if (touch) onMove(touch.clientX, touch.clientY);
        };

        const onMouseMove = (e: MouseEvent) => {
            if (!touchStateRef.current) return;
            onMove(e.clientX, e.clientY);
        };

        const onUp = () => {
            if (autoScrollRafRef.current) {
                cancelAnimationFrame(autoScrollRafRef.current);
                autoScrollRafRef.current = null;
            }
            if (touchStateRef.current && isTouchDragRef.current) {
                document.body.style.overflow = "";
                document.body.style.touchAction = "";
            }
            touchStateRef.current = null;
            draggingIdRef.current = null;
            setDraggingId(null);
            setDragPos(null);
            isTouchDragRef.current = false;
        };

        const onTouchEnd = () => onUp();
        const onTouchCancel = () => onUp();
        const onMouseUp = () => onUp();

        document.addEventListener("touchmove", onTouchMove, { passive: false });
        document.addEventListener("touchend", onTouchEnd);
        document.addEventListener("touchcancel", onTouchCancel);
        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);

        return () => {
            document.removeEventListener("touchmove", onTouchMove);
            document.removeEventListener("touchend", onTouchEnd);
            document.removeEventListener("touchcancel", onTouchCancel);
            document.removeEventListener("mousemove", onMouseMove);
            document.removeEventListener("mouseup", onMouseUp);
        };
    }, [profiles]);

    const startDrag = (id: string, clientX: number, clientY: number) => {
        const el = document.querySelector(`[data-profile-id="${id}"]`) as HTMLElement | null;
        if (!el) return;
        const rect = el.getBoundingClientRect();
        touchStateRef.current = {
            id,
            startX: clientX,
            startY: clientY,
            grabOffsetX: clientX - rect.left,
            grabOffsetY: clientY - rect.top,
            width: rect.width,
            height: rect.height,
            activated: true,
        };
        isTouchDragRef.current = false;
        draggingIdRef.current = id;

        setTimeout(() => {
            if (touchStateRef.current && touchStateRef.current.id === id && touchStateRef.current.activated) {
                isTouchDragRef.current = true;
                setDraggingId(id);
                setDragPos({
                    x: touchStateRef.current.startX - touchStateRef.current.grabOffsetX,
                    y: touchStateRef.current.startY - touchStateRef.current.grabOffsetY,
                });
                document.body.style.overflow = "hidden";
                document.body.style.touchAction = "none";
                if (navigator.vibrate) navigator.vibrate(40);
            }
        }, 350);
    };

    const handleTouchStart = (id: string, e: React.TouchEvent) => {
        const touch = e.touches[0];
        if (touch) startDrag(id, touch.clientX, touch.clientY);
    };

    const handleMouseDown = (id: string, e: React.MouseEvent) => {
        e.preventDefault();
        startDrag(id, e.clientX, e.clientY);
    };

    const updateProfile = useCallback((profileId: string, patch: Partial<ImageGenerationProfile>) => {
        const nextProfiles = profiles.map(p => {
            if (p.id !== profileId) return p;
            const updated = { ...p, ...patch };
            if (patch.size !== undefined && patch.extraPrompt === undefined) {
                updated.extraPrompt = withRatioHint(updated.extraPrompt, updated.size);
            }
            return updated;
        });

        const activeId = settings.activeProfileId || profiles[0]?.id;
        const nextActive = nextProfiles.find(p => p.id === activeId) || nextProfiles[0];

        persist({
            ...settings,
            profiles: nextProfiles,
            requestMode: nextActive.requestMode,
            apiKey: nextActive.apiKey,
            baseUrl: nextActive.baseUrl,
            model: nextActive.model,
            size: nextActive.size,
            quality: nextActive.quality,
            extraPrompt: nextActive.extraPrompt,
        });
    }, [persist, profiles, settings]);

    const addProfile = useCallback(() => {
        const newProfile: ImageGenerationProfile = {
            id: `img-profile-${Date.now()}`,
            name: "新方案",
            requestMode: "direct",
            apiKey: "",
            baseUrl: "https://api.openai.com/v1",
            model: "gpt-image-2",
            size: "1024x1024",
            quality: "auto",
            extraPrompt: withRatioHint("", "1024x1024"),
        };
        const nextProfiles = [...profiles, newProfile];
        persist({
            ...settings,
            profiles: nextProfiles,
        });
        setIsNewProfile(true);
        setEditingId(newProfile.id);
    }, [persist, profiles, settings]);

    const removeProfile = useCallback((profileId: string) => {
        const nextProfiles = profiles.filter(p => p.id !== profileId);
        if (nextProfiles.length === 0) {
            nextProfiles.push({
                id: `img-profile-${Date.now()}`,
                name: "默认生图方案",
                requestMode: "direct",
                apiKey: "",
                baseUrl: "https://api.openai.com/v1",
                model: "gpt-image-2",
                size: "1024x1024",
                quality: "auto",
                extraPrompt: "",
            });
        }
        let nextActiveId = settings.activeProfileId;
        if (nextActiveId === profileId || !nextProfiles.some(p => p.id === nextActiveId)) {
            nextActiveId = nextProfiles[0].id;
        }
        const active = nextProfiles.find(p => p.id === nextActiveId) || nextProfiles[0];

        persist({
            ...settings,
            activeProfileId: nextActiveId,
            profiles: nextProfiles,
            requestMode: active.requestMode,
            apiKey: active.apiKey,
            baseUrl: active.baseUrl,
            model: active.model,
            size: active.size,
            quality: active.quality,
            extraPrompt: active.extraPrompt,
        });
    }, [persist, profiles, settings]);

    const setActiveProfile = useCallback((profileId: string) => {
        const active = profiles.find(p => p.id === profileId);
        if (!active) return;
        persist({
            ...settings,
            activeProfileId: profileId,
            requestMode: active.requestMode,
            apiKey: active.apiKey,
            baseUrl: active.baseUrl,
            model: active.model,
            size: active.size,
            quality: active.quality,
            extraPrompt: active.extraPrompt,
        });
    }, [persist, profiles, settings]);

    // 头部新增按钮
    useEffect(() => {
        setSubpageRightAction("imageGeneration",
            <button
                onClick={addProfile}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增生图方案</span>
            </button>
        );
        return () => setSubpageRightAction("imageGeneration", null);
    }, [addProfile, setSubpageRightAction]);

    // 弹窗打开时拦截全局返回键，优先关闭弹窗
    useEffect(() => {
        if (editingId) {
            setOverrideBack(() => () => {
                if (isNewProfile && editingId) {
                    removeProfile(editingId);
                }
                setIsNewProfile(false);
                setEditingId(null);
            });
        } else {
            setOverrideBack(null);
        }
        return () => {
            setOverrideBack(null);
        };
    }, [editingId, isNewProfile, removeProfile, setOverrideBack]);

    const selectSize = useCallback((profile: ImageGenerationProfile, value: string) => {
        if (value !== "custom") {
            updateProfile(profile.id, { size: value });
            return;
        }
        const parsed = parseCustomSize(profile.size);
        const next = isCustomSize(profile.size) && parsed ? `${parsed.w}x${parsed.h}` : lastCustomSize.current;
        const [w, h] = next.split("x");
        setCustomW(w || "2048");
        setCustomH(h || "2048");
        lastCustomSize.current = next;
        updateProfile(profile.id, { size: next });
    }, [updateProfile]);

    const updateCustomSize = useCallback((profile: ImageGenerationProfile, w: string, h: string) => {
        const nw = w.replace(/\D/g, "");
        const nh = h.replace(/\D/g, "");
        setCustomW(nw);
        setCustomH(nh);
        if (/^\d{2,5}$/.test(nw) && /^\d{2,5}$/.test(nh)) {
            const next = `${nw}x${nh}`;
            lastCustomSize.current = next;
            updateProfile(profile.id, { size: next });
        }
    }, [updateProfile]);

    const updateImageHosting = useCallback((patch: Partial<ImageGenerationSettingsType["imageHosting"]>) => {
        persist({
            ...settings,
            imageHosting: {
                ...settings.imageHosting,
                ...patch,
            },
        });
    }, [persist, settings]);

    const fetchModels = async (profile: ImageGenerationProfile) => {
        setStatus(prev => ({ ...prev, [profile.id]: null }));
        if (!profile.apiKey.trim() || !profile.baseUrl.trim()) {
            setStatus(prev => ({ ...prev, [profile.id]: { success: false, message: "请先填写 Base URL 和 API Key。" } }));
            return;
        }
        setIsFetchingModels(prev => ({ ...prev, [profile.id]: true }));
        try {
            const fetched = await fetchImageGenerationModels(profile);
            setFetchedModels(prev => ({ ...prev, [profile.id]: fetched }));
            setStatus(prev => ({
                ...prev,
                [profile.id]: {
                    success: true,
                    message: fetched.length > 0 ? `已拉取 ${fetched.length} 个模型。` : "接口返回为空，可手动填写模型名。",
                },
            }));
        } catch (err) {
            setFetchedModels(prev => ({ ...prev, [profile.id]: [] }));
            setStatus(prev => ({ ...prev, [profile.id]: { success: false, message: err instanceof Error ? err.message : String(err) } }));
        } finally {
            setIsFetchingModels(prev => ({ ...prev, [profile.id]: false }));
        }
    };

    const testGeneration = async (profile: ImageGenerationProfile) => {
        setStatus(prev => ({ ...prev, [profile.id]: null }));
        setIsTesting(prev => ({ ...prev, [profile.id]: true }));
        try {
            const result = await generateImageFromConfiguredApi({
                description: "一张放在桌面上的白色咖啡杯，柔和自然光，真实照片风格",
                settings: {
                    ...settings,
                    enabled: true,
                    requestMode: profile.requestMode,
                    apiKey: profile.apiKey,
                    baseUrl: profile.baseUrl,
                    model: profile.model,
                    size: profile.size,
                    quality: profile.quality,
                    extraPrompt: profile.extraPrompt,
                },
            });
            if (!result) throw new Error("图像生成未返回结果。");
            if (testPreviewUrl[profile.id]) URL.revokeObjectURL(testPreviewUrl[profile.id]!);
            setTestPreviewUrl(prev => ({ ...prev, [profile.id]: URL.createObjectURL(result.blob) }));
            setStatus(prev => ({ ...prev, [profile.id]: { success: true, message: "测试生图成功。" } }));
        } catch (err) { 
            setStatus(prev => ({ ...prev, [profile.id]: { success: false, message: err instanceof Error ? err.message : String(err) } }));
        } finally {
            setIsTesting(prev => ({ ...prev, [profile.id]: false }));
        }
    };

    const uploadReference = async (characterId: string, file: File) => {
        const assetId = await saveChatImageToIndexedDB(file);
        persist({
            ...settings,
            characterReferences: {
                ...(settings.characterReferences || {}),
                [characterId]: { assetId, updatedAt: Date.now() },
            },
        });
    };

    const removeReference = (characterId: string) => {
        const nextRefs = { ...(settings.characterReferences || {}) };
        delete nextRefs[characterId];
        persist({ ...settings, characterReferences: nextRefs });
        setReferencePreviews(prev => {
            const next = { ...prev };
            delete next[characterId];
            return next;
        });
    };

    return (
        <div className="flex flex-col gap-6 pb-8">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">Image Generation</h2>
            </div>

            {/* 全局自动生图开关 */}
            <div className="menu-group">
                <div className="menu-item">
                    <span className="card-icon" style={imageGenerationIconStyle}>
                        <Sparkles size={22} strokeWidth={1.75} />
                    </span>
                    <span className="settings-tools-menu-copy">
                        <span className="menu-label appearance-menu-item-label">启用自动生图</span>
                        <span className="menu-desc settings-tools-menu-desc">角色输出照片标签时自动调用当前激活的生图方案。</span>
                    </span>
                    <span className="menu-right settings-tools-menu-toggle">
                        <Toggle
                            checked={settings.enabled}
                            onChange={(enabled) => persist({ ...settings, enabled })}
                            className="settings-toggle-control"
                        />
                    </span>
                </div>
            </div>

            {/* 生图方案卡片网格 */}
            <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between px-1">
                    <p className="settings-menu-section-title !m-0">生图方案列表</p>
                    <span className="menu-desc text-xs">点击卡片设为当前使用</span>
                </div>

                {allGroups.length > 2 && (
                    <div className="flex gap-1.5 overflow-x-auto pb-1 hide-scrollbar">
                        {allGroups.map((grp) => (
                            <button
                                key={grp}
                                type="button"
                                onClick={() => setSelectedGroup(grp)}
                                className={`px-3 py-1 text-xs font-semibold rounded-full whitespace-nowrap transition-colors ${
                                    selectedGroup === grp
                                        ? "bg-black text-white shadow-sm"
                                        : "bg-black/5 text-black/60 hover:bg-black/10"
                                }`}
                            >
                                {grp}
                            </button>
                        ))}
                    </div>
                )}

                <div className="grid grid-cols-2 gap-3 relative">
                    {displayedProfiles.map(profile => {
                        const isActive = profile.id === activeProfileId;
                        const isDragging = draggingId === profile.id;
                        return (
                            <div
                                key={profile.id}
                                data-profile-id={profile.id}
                                onMouseDown={(e) => handleMouseDown(profile.id, e)}
                                onTouchStart={(e) => handleTouchStart(profile.id, e)}
                                className={`ui-config-card min-w-0 cursor-pointer select-none transition-all ${
                                    isActive ? "ring-2 ring-black shadow-sm" : ""
                                } ${
                                    isDragging ? "opacity-30 border-dashed border-2 border-black/40 scale-95" : ""
                                }`}
                                style={{
                                    aspectRatio: "3 / 2",
                                    padding: "12px",
                                    justifyContent: "space-between",
                                    touchAction: "manipulation",
                                    transition: "transform 200ms ease, opacity 200ms ease",
                                }}
                                role="button"
                                tabIndex={0}
                                aria-label={`选择 ${profile.name || "未命名方案"}`}
                                onClick={() => {
                                    if (isTouchDragRef.current) return;
                                    setActiveProfile(profile.id);
                                }}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setActiveProfile(profile.id);
                                    }
                                }}
                            >
                                <div className="min-w-0 flex flex-col gap-1 pointer-events-none">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">
                                            {profile.name || "未命名方案"}
                                        </span>
                                        {isActive && (
                                            <span className="shrink-0 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                使用中
                                            </span>
                                        )}
                                    </div>
                                    <span className="menu-desc truncate">{profile.model || "未设置模型"}</span>
                                </div>
                                <div className="flex gap-2 shrink-0 items-center justify-end">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setIsNewProfile(false);
                                            setEditingId(profile.id);
                                        }}
                                        className="ui-link-btn"
                                        title="编辑方案"
                                    >
                                        <FileEdit size={18} />
                                    </button>
                                    {profiles.length > 1 && (
                                        <button
                                            type="button"
                                            onClick={(event) => {
                                                event.stopPropagation();
                                                setConfirmDeleteId(profile.id);
                                            }}
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            title="删除方案"
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </div>
                            </div>
                        );
                    })}

                    {/* 拖拽中的跟随悬浮卡片 (Portal Ghost) */}
                    {draggingId && dragPos && touchStateRef.current && (() => {
                        const draggedProfile = profiles.find(p => p.id === draggingId);
                        if (!draggedProfile) return null;
                        const isActive = draggedProfile.id === activeProfileId;
                        return (
                            <div
                                id="image-drag-ghost"
                                className="ui-config-card pointer-events-none fixed z-[9999] shadow-2xl ring-2 ring-black bg-[var(--c-card-bg,white)] scale-105"
                                style={{
                                    left: `${dragPos.x}px`,
                                    top: `${dragPos.y}px`,
                                    width: `${touchStateRef.current.width}px`,
                                    height: `${touchStateRef.current.height}px`,
                                    padding: "12px",
                                    justifyContent: "space-between",
                                    borderRadius: "16px",
                                    margin: 0,
                                }}
                            >
                                <div className="min-w-0 flex flex-col gap-1">
                                    <div className="flex items-center gap-1.5 min-w-0">
                                        <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">
                                            {draggedProfile.name || "未命名方案"}
                                        </span>
                                        {isActive && (
                                            <span className="shrink-0 rounded-full bg-black px-1.5 py-0.5 text-[10px] font-medium text-white">
                                                使用中
                                            </span>
                                        )}
                                    </div>
                                    <span className="menu-desc truncate">{draggedProfile.model || "未设置模型"}</span>
                                </div>
                                <div className="flex gap-2 shrink-0 items-center justify-end opacity-60">
                                    <FileEdit size={18} />
                                    {profiles.length > 1 && <Trash2 size={18} />}
                                </div>
                            </div>
                        );
                    })()}
                </div>
            </div>

            {/* 编辑方案抽屉弹窗 */}
            {editingProfile && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button
                                onClick={() => {
                                    if (isNewProfile && editingId) removeProfile(editingId);
                                    setIsNewProfile(false);
                                    setEditingId(null);
                                }}
                                className="modal-header-btn modal-header-btn-muted"
                            >
                                <X size={18} />
                            </button>
                            <span className="modal-header-title">{isNewProfile ? "添加生图方案" : "编辑生图方案"}</span>
                            <button
                                onClick={() => {
                                    setIsNewProfile(false);
                                    setEditingId(null);
                                }}
                                className="modal-header-btn modal-header-btn-action"
                            >
                                <Check size={18} />
                            </button>
                        </div>

                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">方案名称 (Name)</label>
                                <Input
                                    type="text"
                                    value={editingProfile.name || ""}
                                    onChange={(e) => updateProfile(editingProfile.id, { name: e.target.value })}
                                    placeholder="例如: 快速生图 / 高清人像"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">所属分组 (留空为默认)</label>
                                <Input
                                    type="text"
                                    value={editingProfile.group || ""}
                                    onChange={(e) => updateProfile(editingProfile.id, { group: e.target.value })}
                                    placeholder="例如: 动漫 / 写实 / 快速 (留空默认)"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">请求方式</label>
                                <Select
                                    value={editingProfile.requestMode}
                                    onChange={(event) => updateProfile(editingProfile.id, {
                                        requestMode: event.target.value as ImageGenerationSettingsType["requestMode"],
                                    })}
                                >
                                    <option value="direct">浏览器直连</option>
                                    <option value="server">服务端转发</option>
                                </Select>
                                <span className="menu-desc ml-1">
                                    浏览器直连直接从当前设备请求生图 API，可绕开部署平台函数超时；需要接口允许跨域。
                                </span>
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">Base URL</label>
                                <Input
                                    type="url"
                                    value={editingProfile.baseUrl}
                                    onChange={(event) => updateProfile(editingProfile.id, { baseUrl: event.target.value })}
                                    placeholder="https://api.openai.com/v1"
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">API Key</label>
                                <Input
                                    type="password"
                                    value={editingProfile.apiKey}
                                    onChange={(event) => updateProfile(editingProfile.id, { apiKey: event.target.value })}
                                    placeholder="sk-..."
                                />
                            </div>

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">模型名</label>
                                <div className="flex gap-2">
                                    <div className="relative flex-1">
                                        <Input
                                            type="text"
                                            value={editingProfile.model}
                                            onChange={(event) => updateProfile(editingProfile.id, { model: event.target.value })}
                                            placeholder="gpt-image-2 / dall-e-3 / flux-schnell"
                                            className={(fetchedModels[editingProfile.id] || []).length > 0 ? "w-full pr-9" : "w-full"}
                                        />
                                        {(fetchedModels[editingProfile.id] || []).length > 0 && (
                                            <>
                                                <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60" />
                                                <select
                                                    aria-label="选择拉取到的模型"
                                                    value=""
                                                    onChange={(event) => {
                                                        if (event.target.value) updateProfile(editingProfile.id, { model: event.target.value });
                                                    }}
                                                    className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                                                >
                                                    <option value="">选择拉取到的模型...</option>
                                                    {filterLikelyImageModels(fetchedModels[editingProfile.id]).map(model => (
                                                        <option key={model} value={model}>{model}</option>
                                                    ))}
                                                </select>
                                            </>
                                        )}
                                    </div>
                                    <button
                                        type="button"
                                        onClick={() => fetchModels(editingProfile)}
                                        disabled={isFetchingModels[editingProfile.id]}
                                        className="ui-btn ui-btn-soft-action shrink-0"
                                    >
                                        <RefreshCw size={16} className={isFetchingModels[editingProfile.id] ? "animate-spin" : ""} />
                                        {isFetchingModels[editingProfile.id] ? "拉取中" : "拉取模型"}
                                    </button>
                                </div>
                            </div>

                            <div className="grid grid-cols-2 gap-3">
                                <div className="flex flex-col gap-1">
                                    <div className="flex items-center justify-between ml-1">
                                        <label className="menu-desc">尺寸</label>
                                        <div className="flex gap-1 bg-[var(--c-input)] p-0.5 rounded-lg">
                                            <button
                                                type="button"
                                                onClick={() => setSizeTab("default")}
                                                className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md transition-all ${
                                                    sizeTab === "default"
                                                        ? "bg-black text-white shadow-xs"
                                                        : "text-[var(--c-text-sub)] hover:text-black"
                                                }`}
                                            >
                                                竖版
                                            </button>
                                            <button
                                                type="button"
                                                onClick={() => setSizeTab("landscape")}
                                                className={`px-1.5 py-0.5 text-[10px] font-medium rounded-md transition-all ${
                                                    sizeTab === "landscape"
                                                        ? "bg-black text-white shadow-xs"
                                                        : "text-[var(--c-text-sub)] hover:text-black"
                                                }`}
                                            >
                                                横版
                                            </button>
                                        </div>
                                    </div>
                                    <Select
                                        value={isCustomSize(editingProfile.size) ? "custom" : editingProfile.size}
                                        onChange={(event) => selectSize(editingProfile, event.target.value)}
                                    >
                                        {/* 当前选中的值如果不属于当前 tab，先作为一项展示以防显示空白 */}
                                        {!isCustomSize(editingProfile.size) &&
                                            editingProfile.size !== "custom" &&
                                            !(sizeTab === "default" ? PORTRAIT_SIZE_PRESETS : LANDSCAPE_SIZE_PRESETS).some(i => i.value === editingProfile.size) && (
                                                <option value={editingProfile.size}>
                                                    {SIZE_LABEL_MAP[editingProfile.size] || editingProfile.size}
                                                </option>
                                            )
                                        }
                                        {(sizeTab === "default" ? PORTRAIT_SIZE_PRESETS : LANDSCAPE_SIZE_PRESETS).map(item => (
                                            <option key={item.value} value={item.value}>{item.label}</option>
                                        ))}
                                        <option value="custom">自定义…</option>
                                    </Select>
                                </div>
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">质量</label>
                                    <Select
                                        value={editingProfile.quality}
                                        onChange={(event) => updateProfile(editingProfile.id, { quality: event.target.value })}
                                    >
                                        {QUALITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                                    </Select>
                                </div>
                            </div>

                            {isCustomSize(editingProfile.size) && (
                                <div className="flex flex-col gap-1">
                                    <label className="menu-desc ml-1">自定义分辨率（宽 × 高）</label>
                                    <div className="flex items-center gap-2">
                                        <Input
                                            type="text"
                                            inputMode="numeric"
                                            value={customW}
                                            onChange={(event) => updateCustomSize(editingProfile, event.target.value, customH)}
                                            placeholder="宽，如 2048"
                                            className="flex-1"
                                        />
                                        <span className="menu-desc shrink-0">×</span>
                                        <Input
                                            type="text"
                                            inputMode="numeric"
                                            value={customH}
                                            onChange={(event) => updateCustomSize(editingProfile, customW, event.target.value)}
                                            placeholder="高，如 2048"
                                            className="flex-1"
                                        />
                                        <span className="menu-desc shrink-0">px</span>
                                    </div>
                                    <span className="menu-desc ml-1 opacity-70">
                                        以「宽x高」格式原样发给生图 API；宽高各填 2~5 位数字才生效。
                                    </span>
                                </div>
                            )}

                            <div className="flex flex-col gap-1">
                                <label className="menu-desc ml-1">补充提示词</label>
                                <Textarea
                                    value={editingProfile.extraPrompt}
                                    onChange={(event) => updateProfile(editingProfile.id, { extraPrompt: event.target.value })}
                                    placeholder="会和角色输出的图片描述一起发送给生图模型。"
                                    rows={4}
                                />
                                <p className="menu-desc ml-1 opacity-70">
                                    选择尺寸后会自动在末尾追加一句「{RATIO_HINT_MARKER}…」构图提示，用于纠正部分不认 size 参数的接口。可手动修改或删除。
                                </p>
                            </div>

                            <div className="flex gap-3">
                                <button
                                    type="button"
                                    onClick={() => testGeneration(editingProfile)}
                                    disabled={isTesting[editingProfile.id]}
                                    className="ui-btn ui-btn-success flex-1"
                                >
                                    <ImageIcon size={16} />
                                    {isTesting[editingProfile.id] ? "测试中..." : "测试生图"}
                                </button>
                            </div>

                            {status[editingProfile.id] && (
                                <Alert variant={status[editingProfile.id]!.success ? "success" : "danger"}>
                                    <AlertCircle size={16} className="mt-[2px] shrink-0" />
                                    <span className="break-all leading-[1.5]">{status[editingProfile.id]!.message}</span>
                                </Alert>
                            )}
                            {testPreviewUrl[editingProfile.id] && (
                                <img
                                    src={testPreviewUrl[editingProfile.id]!}
                                    alt="测试生图结果"
                                    className="max-h-[220px] max-w-full self-start rounded-xl border border-[var(--c-card-border)] object-contain"
                                />
                            )}
                        </div>
                    </div>
                </div>
            )}

            {/* 删除确认对话框 */}
            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除生图方案后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeProfile(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}

            {/* 公共图床配置 */}
            <div className="flex flex-col gap-2">
                <p className="settings-menu-section-title">Image Hosting</p>
                <div className="menu-group">
                    <div className="menu-item">
                        <span className="card-icon" style={imageGenerationIconStyle}>
                            <Upload size={22} strokeWidth={1.75} />
                        </span>
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">允许小卷上传图床</span>
                            <span className="menu-desc settings-tools-menu-desc">开启后，小卷的图像处理套件可以把本地素材上传到公开图床并拿 URL 写 CSS。</span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.allowMascotUpload}
                                onChange={(allowMascotUpload) => updateImageHosting({ allowMascotUpload })}
                                className="settings-toggle-control"
                            />
                        </span>
                    </div>
                </div>

                <div className="menu-group p-4 flex flex-col gap-4">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">图床提供方</label>
                        <Select
                            value={settings.imageHosting.provider}
                            onChange={(event) => updateImageHosting({
                                provider: event.target.value as ImageGenerationSettingsType["imageHosting"]["provider"],
                            })}
                        >
                            {IMAGE_HOSTING_PROVIDER_OPTIONS.map(option => (
                                <option key={option.value} value={option.value}>{option.label}</option>
                            ))}
                        </Select>
                    </div>

                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">ImgBB API Key</label>
                        <Input
                            type="password"
                            value={settings.imageHosting.imgbbApiKey}
                            onChange={(event) => updateImageHosting({ imgbbApiKey: event.target.value })}
                            placeholder="从 imgbb.com/api/1 获取"
                            disabled={settings.imageHosting.provider !== "imgbb"}
                        />
                        <span className="menu-desc ml-1">Key 只保存在当前项目设置里；小卷工具结果不会显示它。</span>
                    </div>

                    <div className="grid grid-cols-2 gap-3">
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">默认过期秒数</label>
                            <Input
                                type="number"
                                min={0}
                                max={15552000}
                                value={settings.imageHosting.defaultExpirationSeconds}
                                onChange={(event) => updateImageHosting({
                                    defaultExpirationSeconds: Math.max(0, Number.parseInt(event.target.value, 10) || 0),
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">0 表示不过期。</span>
                        </div>
                        <div className="flex flex-col gap-1">
                            <label className="menu-desc ml-1">上传上限 KB</label>
                            <Input
                                type="number"
                                min={64}
                                max={32768}
                                value={Math.round(settings.imageHosting.maxUploadBytes / 1024)}
                                onChange={(event) => updateImageHosting({
                                    maxUploadBytes: Math.max(64, Number.parseInt(event.target.value, 10) || 900) * 1024,
                                })}
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                            <span className="menu-desc ml-1">默认 900KB，适合 CSS 主题素材。</span>
                        </div>
                    </div>

                    <div className="menu-item !px-0 !py-0">
                        <span className="settings-tools-menu-copy">
                            <span className="menu-label appearance-menu-item-label">上传前自动转 WebP</span>
                            <span className="menu-desc settings-tools-menu-desc">减小 PNG/JPEG 体积；GIF 会保留原格式。</span>
                        </span>
                        <span className="menu-right settings-tools-menu-toggle">
                            <Toggle
                                checked={settings.imageHosting.autoConvertToWebp}
                                onChange={(autoConvertToWebp) => updateImageHosting({ autoConvertToWebp })}
                                className="settings-toggle-control"
                                disabled={settings.imageHosting.provider !== "imgbb"}
                            />
                        </span>
                    </div>
                </div>
            </div>

            {/* 公共角色参考图 */}
            <div className="flex flex-col gap-2">
                <p className="settings-menu-section-title">Character References</p>
                <div className="menu-group">
                    {characters.length === 0 ? (
                        <div className="ui-empty py-8">
                            <Camera size={22} />
                            <span className="menu-desc">暂无角色。</span>
                        </div>
                    ) : characters.map(character => {
                        const preview = referencePreviews[character.id];
                        return (
                            <div key={character.id} className="menu-item">
                                <span className="h-11 w-11 shrink-0 overflow-hidden rounded-xl bg-[var(--c-input)]">
                                    {preview ? (
                                        <img src={preview} alt="" className="h-full w-full object-cover" />
                                    ) : character.avatar ? (
                                        <img src={character.avatar} alt="" className="h-full w-full object-cover" />
                                    ) : (
                                        <span className="flex h-full w-full items-center justify-center ts-13 font-semibold text-[var(--c-icon)]">
                                            {character.name.slice(0, 1)}
                                        </span>
                                    )}
                                </span>
                                <span className="min-w-0 flex flex-1 flex-col">
                                    <span className="menu-label truncate">{character.name}</span>
                                    <span className="menu-desc truncate">{preview ? "已上传参考图" : "未上传参考图"}</span>
                                </span>
                                <span className="menu-right flex gap-2">
                                    <button
                                        type="button"
                                        className="ui-link-btn"
                                        aria-label={`上传 ${character.name} 的参考图`}
                                        onClick={() => {
                                            const input = document.createElement("input");
                                            input.type = "file";
                                            input.accept = "image/*";
                                            input.onchange = async () => {
                                                const file = input.files?.[0];
                                                if (file) await uploadReference(character.id, file);
                                            };
                                            input.click();
                                        }}
                                    >
                                        <Upload size={18} />
                                    </button>
                                    {preview && (
                                        <button
                                            type="button"
                                            className="ui-link-btn"
                                            data-variant="danger"
                                            aria-label={`删除 ${character.name} 的参考图`}
                                            onClick={() => removeReference(character.id)}
                                        >
                                            <Trash2 size={18} />
                                        </button>
                                    )}
                                </span>
                            </div>
                        );
                    })}
                </div>
            </div>

        </div>
    );
}

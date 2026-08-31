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

const SIZE_PRESET_ITEMS = [
    { value: "auto", label: "auto" },
    { value: "1024x1024", label: "1024×1024 (2K)" },
    { value: "1536x1024", label: "1536×1024 (2K)" },
    { value: "1920x1080", label: "1920×1080 (2K)" },
    { value: "2048x2048", label: "2048×2048 (4K)" },
    { value: "2560x1712", label: "2560×1712 (4K)" },
    { value: "3840x2160", label: "3840×2160 (4K)" },
] as const;

const SIZE_PRESETS = SIZE_PRESET_ITEMS.map(i => i.value);
const SIZE_OPTIONS = [...SIZE_PRESETS, "custom"];
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
    "1536x1024": "横向 3:2 构图，horizontal landscape composition",
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
    const { setSubpageRightAction } = useContext(SettingsContext);
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

                <div className="grid grid-cols-2 gap-3">
                    {profiles.map(profile => {
                        const isActive = profile.id === activeProfileId;
                        return (
                            <div
                                key={profile.id}
                                className={`ui-config-card min-w-0 cursor-pointer transition-all ${
                                    isActive ? "ring-2 ring-black shadow-sm" : ""
                                }`}
                                style={{ aspectRatio: "3 / 2", padding: "12px", justifyContent: "space-between" }}
                                role="button"
                                tabIndex={0}
                                aria-label={`选择 ${profile.name || "未命名方案"}`}
                                onClick={() => setActiveProfile(profile.id)}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setActiveProfile(profile.id);
                                    }
                                }}
                            >
                                <div className="min-w-0 flex flex-col gap-1">
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
                                    <label className="menu-desc ml-1">尺寸</label>
                                    <Select
                                        value={isCustomSize(editingProfile.size) ? "custom" : editingProfile.size}
                                        onChange={(event) => selectSize(editingProfile, event.target.value)}
                                    >
                                        {SIZE_PRESET_ITEMS.map(item => (
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

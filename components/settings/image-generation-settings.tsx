"use client";

import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from "react";
import { AlertCircle, Camera, ChevronDown, Image, RefreshCw, Sparkles, Trash2, Upload } from "lucide-react";
import type { ImageGenerationSettings as ImageGenerationSettingsType } from "@/lib/settings-types";
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
import { Input, Select, Textarea, Toggle } from "@/components/ui/form";

const SIZE_PRESETS = ["auto", "1024x1024", "1024x1536", "1536x1024"] as const;
const SIZE_OPTIONS = [...SIZE_PRESETS, "custom"];
const QUALITY_OPTIONS = ["auto", "low", "medium", "high"];

/** 判断是否为自定义尺寸（不在预设列表里的合法 WxH 字符串；"custom" 是下拉占位值不算） */
function isCustomSize(size: string): boolean {
    return size !== "custom" && !(SIZE_PRESETS as readonly string[]).includes(size);
}

/** 从 "WxH" 解析宽高（支持 x / X / ×） */
function parseCustomSize(size: string): { w: string; h: string } | null {
    const match = /^(\d+)[xX×](\d+)$/.exec(size.trim());
    if (!match) return null;
    return { w: match[1], h: match[2] };
}

function greatestCommonDivisor(a: number, b: number): number {
    return b === 0 ? a : greatestCommonDivisor(b, a % b);
}

// Some relay APIs (e.g. dzzi 的 gpt-image-2) ignore the `size` param and pick
// their own aspect ratio. As a fallback we append a natural-language ratio hint
// to the prompt, which these models DO respect. The marker lets us replace the
// previously-appended hint instead of stacking them when the size changes.
const RATIO_HINT_MARKER = "【画面比例】";
const SIZE_RATIO_HINTS: Record<string, string> = {
    "1024x1024": "正方形 1:1 构图，square 1:1 composition",
    "1024x1536": "竖向 2:3 构图，vertical portrait composition",
    "1536x1024": "横向 3:2 构图，horizontal landscape composition",
};

/** 为任意尺寸生成【画面比例】构图提示：预设直接查表，自定义 WxH 按宽高比生成 */
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

// Remove any auto-appended ratio hint line(s), preserving the user's own text.
function stripRatioHint(text: string): string {
    return text.replace(new RegExp(`\\s*${RATIO_HINT_MARKER}[^\\n]*`, "g"), "").replace(/\s+$/, "");
}

// Return the prompt with the ratio hint for `size` appended (replacing any
// previous hint). `auto` strips the hint entirely.
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
    const [settings, setSettings] = useState<ImageGenerationSettingsType>(DEFAULT_IMAGE_GENERATION_SETTINGS);
    const [characters, setCharacters] = useState<Character[]>([]);
    const [referencePreviews, setReferencePreviews] = useState<Record<string, string>>({});
    const [models, setModels] = useState<string[]>([]);
    const [isFetchingModels, setIsFetchingModels] = useState(false);
    const [isTesting, setIsTesting] = useState(false);
    const [status, setStatus] = useState<Status | null>(null);
    const [testPreviewUrl, setTestPreviewUrl] = useState<string | null>(null);
    const [customW, setCustomW] = useState("2048");
    const [customH, setCustomH] = useState("2048");
    const lastCustomSize = useRef("2048x2048");

    useEffect(() => {
        // Sync the ratio hint to the saved size on load, so the hint is present
        // by default (not only after the user manually switches the size).
        const loaded = loadImageGenerationSettings();
        const syncedExtra = withRatioHint(loaded.extraPrompt, loaded.size);
        if (syncedExtra !== loaded.extraPrompt) {
            const next = { ...loaded, extraPrompt: syncedExtra };
            saveImageGenerationSettings(next);
            setSettings(next);
        } else {
            setSettings(loaded);
        }
        setCharacters(loadCharacters());
    }, []);

    // 自定义尺寸：size 变化时把宽高同步进输入框（用户输入也会触发，值相同则无副作用）
    useEffect(() => {
        if (!isCustomSize(settings.size)) return;
        const parsed = parseCustomSize(settings.size);
        if (!parsed) return;
        lastCustomSize.current = `${parsed.w}x${parsed.h}`;
        setCustomW(parsed.w);
        setCustomH(parsed.h);
    }, [settings.size]);

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
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
        };
    }, [testPreviewUrl]);

    const persist = useCallback((next: ImageGenerationSettingsType) => {
        setSettings(next);
        saveImageGenerationSettings(next);
    }, []);

    const updateSettings = useCallback((patch: Partial<ImageGenerationSettingsType>) => {
        persist({ ...settings, ...patch });
    }, [persist, settings]);

    // Changing the size also refreshes the auto-appended ratio hint in the
    // 补充提示词 box (replacing any previous hint), so models that ignore the
    // `size` param still produce the requested orientation.
    const applySize = useCallback((size: string) => {
        persist({ ...settings, size, extraPrompt: withRatioHint(settings.extraPrompt, size) });
    }, [persist, settings]);

    // 尺寸下拉：切到「自定义」时用上次/当前的自定义分辨率落进 size（预设值不作自定义起点）；
    // 切回预设走 applySize（自动换比例提示）。
    const selectSize = useCallback((value: string) => {
        if (value !== "custom") {
            applySize(value);
            return;
        }
        const parsed = parseCustomSize(settings.size);
        const next = isCustomSize(settings.size) && parsed ? `${parsed.w}x${parsed.h}` : lastCustomSize.current;
        const [w, h] = next.split("x");
        setCustomW(w || "2048");
        setCustomH(h || "2048");
        lastCustomSize.current = next;
        applySize(next);
    }, [applySize, settings]);

    // 自定义宽/高输入：两个都合法（2~5 位数字）才写进 size 并刷新比例提示
    const updateCustomSize = useCallback((w: string, h: string) => {
        const nw = w.replace(/\D/g, "");
        const nh = h.replace(/\D/g, "");
        setCustomW(nw);
        setCustomH(nh);
        if (/^\d{2,5}$/.test(nw) && /^\d{2,5}$/.test(nh)) {
            const next = `${nw}x${nh}`;
            lastCustomSize.current = next;
            persist({ ...settings, size: next, extraPrompt: withRatioHint(settings.extraPrompt, next) });
        }
    }, [persist, settings]);

    const updateImageHosting = useCallback((patch: Partial<ImageGenerationSettingsType["imageHosting"]>) => {
        persist({
            ...settings,
            imageHosting: {
                ...settings.imageHosting,
                ...patch,
            },
        });
    }, [persist, settings]);

    const likelyModels = useMemo(() => filterLikelyImageModels(models), [models]);

    const fetchModels = async () => {
        setStatus(null);
        if (!settings.apiKey.trim() || !settings.baseUrl.trim()) {
            setStatus({ success: false, message: "请先填写 Base URL 和 API Key。" });
            return;
        }
        setIsFetchingModels(true);
        try {
            const fetched = await fetchImageGenerationModels(settings);
            setModels(fetched);
            setStatus({
                success: true,
                message: fetched.length > 0 ? `已拉取 ${fetched.length} 个模型。` : "接口返回为空，可手动填写模型名。",
            });
        } catch (err) {
            setModels([]);
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsFetchingModels(false);
        }
    };

    const testGeneration = async () => {
        setStatus(null);
        setIsTesting(true);
        try {
            const result = await generateImageFromConfiguredApi({
                description: "一张放在桌面上的白色咖啡杯，柔和自然光，真实照片风格",
                settings: { ...settings, enabled: true },
            });
            if (!result) throw new Error("图像生成未返回结果。");
            if (testPreviewUrl) URL.revokeObjectURL(testPreviewUrl);
            setTestPreviewUrl(URL.createObjectURL(result.blob));
            setStatus({ success: true, message: "测试生图成功。" });
        } catch (err) {
            setStatus({ success: false, message: err instanceof Error ? err.message : String(err) });
        } finally {
            setIsTesting(false);
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

            <div className="menu-group">
                <div className="menu-item">
                    <span className="card-icon" style={imageGenerationIconStyle}>
                        <Sparkles size={22} strokeWidth={1.75} />
                    </span>
                    <span className="settings-tools-menu-copy">
                        <span className="menu-label appearance-menu-item-label">启用自动生图</span>
                        <span className="menu-desc settings-tools-menu-desc">角色输出照片标签时自动调用图像生成 API。</span>
                    </span>
                    <span className="menu-right settings-tools-menu-toggle">
                        <Toggle checked={settings.enabled} onChange={(enabled) => updateSettings({ enabled })} className="settings-toggle-control" />
                    </span>
                </div>
            </div>

            <div className="menu-group p-4 flex flex-col gap-4">
                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">请求方式</label>
                    <Select
                        value={settings.requestMode}
                        onChange={(event) => updateSettings({
                            requestMode: event.target.value as ImageGenerationSettingsType["requestMode"],
                        })}
                    >
                        <option value="server">服务端转发</option>
                        <option value="direct">浏览器直连</option>
                    </Select>
                    <span className="menu-desc ml-1">
                        浏览器直连会从当前设备直接请求生图 API，可绕开部署平台函数超时；需要接口允许跨域。
                    </span>
                </div>

                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">Base URL</label>
                    <Input
                        type="url"
                        value={settings.baseUrl}
                        onChange={(event) => updateSettings({ baseUrl: event.target.value })}
                        placeholder="https://api.example.com/v1"
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">API Key</label>
                    <Input
                        type="password"
                        value={settings.apiKey}
                        onChange={(event) => updateSettings({ apiKey: event.target.value })}
                        placeholder="sk-..."
                    />
                </div>

                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">模型名</label>
                    <div className="flex gap-2">
                        {/* 单框合一:可手动输入;拉取到模型后右侧出现下拉箭头,点开原生选择器选中即回填 */}
                        <div className="relative flex-1">
                            <Input
                                type="text"
                                value={settings.model}
                                onChange={(event) => updateSettings({ model: event.target.value })}
                                placeholder="gpt-image-2 / image2 / chatgpt-image-latest"
                                className={likelyModels.length > 0 ? "w-full pr-9" : "w-full"}
                            />
                            {likelyModels.length > 0 && (
                                <>
                                    <ChevronDown size={16} className="pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 opacity-60" />
                                    <select
                                        aria-label="选择拉取到的模型"
                                        value=""
                                        onChange={(event) => {
                                            if (event.target.value) updateSettings({ model: event.target.value });
                                        }}
                                        className="absolute inset-y-0 right-0 w-10 cursor-pointer opacity-0"
                                    >
                                        <option value="">选择拉取到的模型...</option>
                                        {likelyModels.map(model => <option key={model} value={model}>{model}</option>)}
                                    </select>
                                </>
                            )}
                        </div>
                        <button
                            type="button"
                            onClick={fetchModels}
                            disabled={isFetchingModels}
                            className="ui-btn ui-btn-soft-action shrink-0"
                        >
                            <RefreshCw size={16} className={isFetchingModels ? "animate-spin" : ""} />
                            {isFetchingModels ? "拉取中" : "拉取模型"}
                        </button>
                    </div>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">尺寸</label>
                        <Select value={isCustomSize(settings.size) ? "custom" : settings.size} onChange={(event) => selectSize(event.target.value)}>
                            {SIZE_OPTIONS.map(option => <option key={option} value={option}>{option === "custom" ? "自定义…" : option}</option>)}
                        </Select>
                    </div>
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">质量</label>
                        <Select value={settings.quality} onChange={(event) => updateSettings({ quality: event.target.value })}>
                            {QUALITY_OPTIONS.map(option => <option key={option} value={option}>{option}</option>)}
                        </Select>
                    </div>
                </div>

                {isCustomSize(settings.size) && (
                    <div className="flex flex-col gap-1">
                        <label className="menu-desc ml-1">自定义分辨率（宽 × 高）</label>
                        <div className="flex items-center gap-2">
                            <Input
                                type="text"
                                inputMode="numeric"
                                value={customW}
                                onChange={(event) => updateCustomSize(event.target.value, customH)}
                                placeholder="宽，如 2048"
                                className="flex-1"
                            />
                            <span className="menu-desc shrink-0">×</span>
                            <Input
                                type="text"
                                inputMode="numeric"
                                value={customH}
                                onChange={(event) => updateCustomSize(customW, event.target.value)}
                                placeholder="高，如 2048"
                                className="flex-1"
                            />
                            <span className="menu-desc shrink-0">px</span>
                        </div>
                        <span className="menu-desc ml-1 opacity-70">
                            以「宽x高」格式原样发给生图 API；宽高各填 2~5 位数字才生效，超出模型支持范围会被 API 拒绝。
                        </span>
                    </div>
                )}

                <div className="flex flex-col gap-1">
                    <label className="menu-desc ml-1">补充提示词</label>
                    <Textarea
                        value={settings.extraPrompt}
                        onChange={(event) => updateSettings({ extraPrompt: event.target.value })}
                        placeholder="会和角色输出的图片描述一起发送给生图模型。"
                        rows={4}
                    />
                    <p className="menu-desc ml-1 opacity-70">
                        选择尺寸后会自动在末尾追加一句「{RATIO_HINT_MARKER}…」构图提示，用于纠正部分不认 size 参数的接口（如 gpt-image-2）。可手动修改或删除。
                    </p>
                </div>

                <div className="flex gap-3">
                    <button
                        type="button"
                        onClick={testGeneration}
                        disabled={isTesting}
                        className="ui-btn ui-btn-success flex-1"
                    >
                        <Image size={16} />
                        {isTesting ? "测试中..." : "测试生图"}
                    </button>
                </div>

                {status && (
                    <Alert variant={status.success ? "success" : "danger"}>
                        <AlertCircle size={16} className="mt-[2px] shrink-0" />
                        <span className="break-all leading-[1.5]">{status.message}</span>
                    </Alert>
                )}
                {testPreviewUrl && (
                    <img
                        src={testPreviewUrl}
                        alt="测试生图结果"
                        className="max-h-[220px] max-w-full self-start rounded-xl border border-[var(--c-card-border)] object-contain"
                    />
                )}
            </div>

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

"use client";

import { useState, useEffect, useCallback, useContext, useMemo, useRef } from "react";
import { Plus, RefreshCw, Rss, AlertCircle, FileEdit, Search, Trash2, X, Check } from "lucide-react";
import { SettingsContext } from "./settings-context";
import type { ApiConfig } from "@/lib/settings-types";
import { loadApiConfigs, removeApiConfigReferences, saveApiConfigs } from "@/lib/settings-storage";
import { generateEmbedding, isEmbeddingModelName } from "@/lib/memory-embedding";
import { ConfirmDialog } from "@/components/ui/modal";
import { Toggle, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";
import { determineBaseUrl, simpleLLMCall } from "@/lib/api-helpers";

const DEFAULT_CONFIGS: ApiConfig[] = [
    {
        id: "default-openai",
        name: "OpenAI 官方",
        provider: "OpenAI",
        apiKey: "",
        defaultModel: "gpt-4o",
        enableNativeTools: true,
        enableImageRecognition: true,
        enableImageGeneration: true,
        preventEmptyGenerateRambling: true,
    }
];

function getNativeToolProtocolLabel(config: ApiConfig): string {
    if (config.provider === "Anthropic" && !config.baseUrl) return "Anthropic";
    if (config.provider === "Google") return "Gemini";
    return "OpenAI-compatible";
}

export function ApiSettings() {
    const { setSubpageRightAction, setOverrideBack } = useContext(SettingsContext);
    const [configs, setConfigs] = useState<ApiConfig[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewConfig, setIsNewConfig] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [isLoaded, setIsLoaded] = useState(false);

    // Testing and Fetching states
    const [isFetching, setIsFetching] = useState<Record<string, boolean>>({});
    const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
    const [modelQuery, setModelQuery] = useState<Record<string, string>>({});
    const [isTesting, setIsTesting] = useState<Record<string, boolean>>({});
    const [testResult, setTestResult] = useState<Record<string, { success: boolean; message: string }>>({});
    const [selectedGroup, setSelectedGroup] = useState<string>("全部");

    // Load from localStorage on mount
    useEffect(() => {
        const loaded = loadApiConfigs();
        if (loaded.length > 0) {
            setConfigs(loaded);
        } else {
            setConfigs(DEFAULT_CONFIGS);
            saveApiConfigs(DEFAULT_CONFIGS);
        }
        setIsLoaded(true);
    }, []);

    const persist = useCallback((newConfigs: ApiConfig[]) => {
        setConfigs(newConfigs);
        saveApiConfigs(newConfigs);
    }, []);

    const addConfig = useCallback(() => {
        const newConfig: ApiConfig = {
            id: `config-${Date.now()}`,
            name: "新配置",
            provider: "Custom",
            apiKey: "",
            defaultModel: "",
            enableNativeTools: true,
            enableImageRecognition: false,
            enableImageGeneration: false,
            preventEmptyGenerateRambling: true,
        };
        persist([...configs, newConfig]);
        setIsNewConfig(true);
        setEditingId(newConfig.id);
    }, [configs, persist]);

    useEffect(() => {
        setSubpageRightAction("api",
            <button
                onClick={addConfig}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增API方案</span>
            </button>
        );
        return () => setSubpageRightAction("api", null);
    }, [addConfig, setSubpageRightAction]);

    const updateConfig = (id: string, updates: Partial<ApiConfig>) => {
        persist(configs.map(c => c.id === id ? { ...c, ...updates } : c));
    };

    const removeConfig = useCallback((id: string) => {
        persist(configs.filter(c => c.id !== id));
        removeApiConfigReferences(id);
        const newFetchedModels = { ...fetchedModels };
        delete newFetchedModels[id];
        setFetchedModels(newFetchedModels);

        const newModelQuery = { ...modelQuery };
        delete newModelQuery[id];
        setModelQuery(newModelQuery);

        const newTestResults = { ...testResult };
        delete newTestResults[id];
        setTestResult(newTestResults);
    }, [configs, fetchedModels, modelQuery, persist, testResult]);

    // 弹窗打开时拦截全局返回键，优先关闭弹窗
    useEffect(() => {
        if (editingId) {
            setOverrideBack(() => () => {
                if (isNewConfig && editingId) {
                    removeConfig(editingId);
                }
                setIsNewConfig(false);
                setEditingId(null);
            });
        } else {
            setOverrideBack(null);
        }
        return () => {
            setOverrideBack(null);
        };
    }, [editingId, isNewConfig, removeConfig, setOverrideBack]);

    // 拖拽排序逻辑
    // 拖拽排序逻辑
    const [draggingId, setDraggingId] = useState<string | null>(null);
    const [dragOverId, setDragOverId] = useState<string | null>(null);
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

    const handleReorder = useCallback((fromIndex: number, toIndex: number) => {
        if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0 || fromIndex >= configs.length || toIndex >= configs.length) return;
        const next = [...configs];
        const [removed] = next.splice(fromIndex, 1);
        next.splice(toIndex, 0, removed);
        persist(next);
    }, [configs, persist]);

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
                const ghostEl = document.getElementById("api-drag-ghost");
                if (ghostEl) ghostEl.style.pointerEvents = "none";
                const targetEl = document.elementFromPoint(clientX, clientY);

                const cardEl = targetEl?.closest("[data-config-id]") as HTMLElement | null;
                if (cardEl && draggingIdRef.current) {
                    const hoverId = cardEl.getAttribute("data-config-id");
                    if (hoverId && hoverId !== draggingIdRef.current) {
                        setConfigs(prev => {
                            const fromIdx = prev.findIndex(c => c.id === draggingIdRef.current);
                            const toIdx = prev.findIndex(c => c.id === hoverId);
                            if (fromIdx === -1 || toIdx === -1 || fromIdx === toIdx) return prev;
                            const next = [...prev];
                            const [item] = next.splice(fromIdx, 1);
                            next.splice(toIdx, 0, item);
                            saveApiConfigs(next);
                            return next;
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
            setDragOverId(null);
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
    }, []);

    const startDrag = (id: string, clientX: number, clientY: number) => {
        const el = document.querySelector(`[data-config-id="${id}"]`) as HTMLElement | null;
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


    // 分组提取与过滤
    const allGroups = useMemo(() => {
        const groups = new Set<string>();
        (configs || []).forEach(c => {
            const g = (c?.group || "").trim();
            if (g) groups.add(g);
            else groups.add("默认");
        });
        return ["全部", ...Array.from(groups)];
    }, [configs]);

    const existingGroups = useMemo(() => {
        const set = new Set<string>();
        (configs || []).forEach(c => {
            const g = (c?.group || "").trim();
            if (g) set.add(g);
        });
        return Array.from(set);
    }, [configs]);

    const displayedConfigs = useMemo(() => {
        if (!Array.isArray(configs)) return [];
        if (selectedGroup === "全部") return configs;
        return configs.filter(c => {
            const g = (c?.group || "").trim() || "默认";
            return g === selectedGroup;
        });
    }, [configs, selectedGroup]);

    // 模型下拉搜索：按关键词实时过滤已拉取模型（大小写不敏感）
    const filteredModels = useMemo(() => {
        const result: Record<string, string[]> = {};
        for (const [id, list] of Object.entries(fetchedModels)) {
            const keyword = (modelQuery[id] || "").trim().toLowerCase();
            result[id] = keyword ? list.filter(model => model.toLowerCase().includes(keyword)) : list;
        }
        return result;
    }, [fetchedModels, modelQuery]);

    // Use unified determineBaseUrl from api-helpers

    const fetchModels = async (config: ApiConfig) => {
        setIsFetching(prev => ({ ...prev, [config.id]: true }));
        setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "" } }));

        try {
            const baseUrl = determineBaseUrl(config);
            if (!baseUrl) throw new Error("缺少 Base URL");
            if (!config.apiKey) throw new Error("缺少 API Key");

            // Gemini 原生协议（/v1beta）：URL 用 ?key= 鉴权，响应是 { models: [{ name }] }
            // OpenAI 兼容（/v1）：Authorization: Bearer + 响应是 { data: [{ id }] }
            const isGoogleNative = config.provider === "Google";
            // 用户常把完整端点填进 Base URL（如 .../v1/embeddings、.../v1/chat/completions），
            // 拼 /models 前剥掉这类端点后缀；已以 /models 结尾则原样使用。
            const modelsBase = baseUrl
                .replace(/\/$/, "")
                .replace(/\/(chat\/completions|completions|embeddings|messages)$/i, "");
            const modelsUrl = /\/models$/i.test(modelsBase) ? modelsBase : `${modelsBase}/models`;
            const url = isGoogleNative
                ? `${modelsUrl}?key=${encodeURIComponent(config.apiKey)}`
                : modelsUrl;
            const headers: Record<string, string> = { "Content-Type": "application/json" };
            if (!isGoogleNative) headers["Authorization"] = `Bearer ${config.apiKey}`;

            const response = await fetch(url, { method: "GET", headers });

            if (!response.ok) {
                const errorData = await response.json().catch(() => ({}));
                throw new Error(errorData.error?.message || `HTTP error! status: ${response.status}`);
            }

            const data = await response.json();
            let modelNames: string[] = [];
            if (isGoogleNative && Array.isArray(data?.models)) {
                // Gemini 原生：name 可能是 "models/gemini-2.5-pro" 或纯名字
                modelNames = data.models.map((m: { name: string }) => (m.name || "").replace(/^models\//, ""));
            } else if (Array.isArray(data?.data)) {
                modelNames = data.data.map((m: { id: string }) => m.id);
            } else {
                throw new Error("返回数据格式不符合预期");
            }
            setFetchedModels(prev => ({ ...prev, [config.id]: modelNames }));
            setModelQuery(prev => ({ ...prev, [config.id]: "" }));
            setTestResult(prev => ({ ...prev, [config.id]: { success: true, message: `成功获取 ${modelNames.length} 个模型` } }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: `拉取失败: ${msg}` } }));
            setFetchedModels(prev => ({ ...prev, [config.id]: [] }));
        } finally {
            setIsFetching(prev => ({ ...prev, [config.id]: false }));
        }
    };

    const testConnection = async (config: ApiConfig) => {
        if (!config.defaultModel) {
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "请先输入或选择默认模型" } }));
            return;
        }

        setIsTesting(prev => ({ ...prev, [config.id]: true }));
        setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: "" } }));

        try {
            // 向量模型配置：测 /embeddings 端点。原来一律测 /chat/completions，
            // 导致 embedding 配置永远 404「测试失败」。
            if (isEmbeddingModelName(config.defaultModel)) {
                const embedding = await generateEmbedding("你好", config, { throwOnError: true });
                if (!embedding) throw new Error("接口未返回向量数据");
                setTestResult(prev => ({
                    ...prev,
                    [config.id]: { success: true, message: `测试成功! 向量模型可用，维度 ${embedding.length}` },
                }));
                return;
            }
            const result = await simpleLLMCall(
                config,
                [{ role: "user", content: "你好" }],
                // Cap (not spend): reasoning models (deepseek-reasoner / gemini-pro 等) burn
                // tokens on hidden reasoning first, so a tiny cap leaves the visible
                // content empty and the test falsely fails (finishReason=length).
                // 4096 covers heavy thinkers; a "你好" reply still stops well before it.
                { temperature: 0.2, max_tokens: 4096 },
            );
            if (result.error || !result.content) {
                throw new Error(result.error || "模型返回了空内容");
            }
            const reply = result.content.replace(/\s+/g, " ").trim();
            const preview = reply.length > 80 ? `${reply.slice(0, 80)}...` : reply;
            setTestResult(prev => ({
                ...prev,
                [config.id]: { success: true, message: `测试成功! 模型回复: ${preview}` },
            }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setTestResult(prev => ({ ...prev, [config.id]: { success: false, message: `测试失败: ${msg}` } }));
        } finally {
            setIsTesting(prev => ({ ...prev, [config.id]: false }));
        }
    };

    if (!isLoaded) return null;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">API Settings</h2>
            </div>

            {configs.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <AlertCircle size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有 API 配置</span>
                    <span className="menu-desc max-w-[240px]">
                        配置 API 密钥和模型以连接到 AI 服务。
                    </span>
                    <button onClick={addConfig} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加配置
                    </button>
                </div>
            ) : (
                <div className="flex flex-col gap-3">
                    {allGroups && allGroups.length > 2 && (
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
                    {displayedConfigs.map((config) => {
                        const isDragging = draggingId === config.id;
                        return (
                            <div
                                key={config.id}
                                data-config-id={config.id}
                                onMouseDown={(e) => handleMouseDown(config.id, e)}
                                onTouchStart={(e) => handleTouchStart(config.id, e)}
                                className={`ui-config-card min-w-0 cursor-pointer select-none transition-all ${
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
                                aria-label={`编辑 ${config.name || config.provider}`}
                                onClick={() => {
                                    if (isTouchDragRef.current) return;
                                    setEditingId(config.id);
                                }}
                                onKeyDown={(event) => {
                                    if (event.target !== event.currentTarget) return;
                                    if (event.key === "Enter" || event.key === " ") {
                                        event.preventDefault();
                                        setEditingId(config.id);
                                    }
                                }}
                            >
                                <div className="min-w-0 flex flex-col gap-1 pointer-events-none">
                                    <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">{config.name || config.provider}</span>
                                    <span className="menu-desc truncate">{config.defaultModel || config.provider || "未设置模型"}</span>
                                </div>
                                <div className="flex gap-2 shrink-0 items-center justify-end">
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setEditingId(config.id);
                                        }}
                                        className="ui-link-btn"
                                        title="编辑"
                                    >
                                        <FileEdit size={18} />
                                    </button>
                                    <button
                                        type="button"
                                        onClick={(event) => {
                                            event.stopPropagation();
                                            setConfirmDeleteId(config.id);
                                        }}
                                        className="ui-link-btn"
                                        data-variant="danger"
                                        title="删除"
                                    >
                                        <Trash2 size={18} />
                                    </button>
                                </div>
                            </div>
                        );
                    })}

                    {/* 拖拽中的跟随悬浮卡片 (Portal Ghost) */}
                    {draggingId && dragPos && touchStateRef.current && (() => {
                        const draggedConfig = configs.find(c => c.id === draggingId);
                        if (!draggedConfig) return null;
                        return (
                            <div
                                id="api-drag-ghost"
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
                                    <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">{draggedConfig.name || draggedConfig.provider}</span>
                                    <span className="menu-desc truncate">{draggedConfig.defaultModel || draggedConfig.provider || "未设置模型"}</span>
                                </div>
                                <div className="flex gap-2 shrink-0 items-center justify-end opacity-60">
                                    <FileEdit size={18} />
                                    <Trash2 size={18} />
                                </div>
                            </div>
                        );
                    })()}
                    </div>
                </div>
            )}

            {editingId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { if (isNewConfig && editingId) removeConfig(editingId); setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewConfig ? "添加配置" : "编辑配置"}</span>
                            <button onClick={() => { setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar flex flex-col gap-4 pb-10" data-ui="modal-body">
                            {(() => {
                                const config = configs.find(c => c.id === editingId);
                                if (!config) return null;
                                return (
                                    <>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">配置名称 (Name)</label>
                                            <Input
                                                type="text"
                                                value={config.name || ""}
                                                onChange={(e) => updateConfig(config.id, { name: e.target.value })}
                                                placeholder="例如: 我的 OpenAI"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1.5">
                                            <div className="flex items-center justify-between ml-1">
                                                <label className="menu-desc">所属分组 (留空为默认)</label>
                                                {config.group && (
                                                    <button
                                                        type="button"
                                                        onClick={() => updateConfig(config.id, { group: "" })}
                                                        className="text-[11px] text-[var(--c-subtext,#888)] hover:text-red-500 transition-colors"
                                                    >
                                                        设为默认
                                                    </button>
                                                )}
                                            </div>
                                            <Input
                                                type="text"
                                                list="existing-api-groups"
                                                value={config.group || ""}
                                                onChange={(e) => updateConfig(config.id, { group: e.target.value })}
                                                placeholder="输入新分组或选择已有分组 (留空默认)"
                                            />
                                            <datalist id="existing-api-groups">
                                                {existingGroups.map(g => (
                                                    <option key={g} value={g} />
                                                ))}
                                            </datalist>
                                            {existingGroups.length > 0 && (
                                                <div className="flex flex-wrap gap-1.5 mt-0.5">
                                                    {existingGroups.map((grp) => {
                                                        const isSelected = (config.group || "").trim() === grp;
                                                        return (
                                                            <button
                                                                key={grp}
                                                                type="button"
                                                                onClick={() => updateConfig(config.id, { group: isSelected ? "" : grp })}
                                                                className={`px-2.5 py-0.5 text-xs rounded-full border transition-all ${
                                                                    isSelected
                                                                        ? "bg-black text-white border-black font-semibold shadow-xs"
                                                                        : "bg-black/5 text-black/70 border-transparent hover:bg-black/10"
                                                                }`}
                                                            >
                                                                {grp}
                                                            </button>
                                                        );
                                                    })}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">服务商 (Provider)</label>
                                            <select
                                                value={config.provider}
                                                onChange={(e) => updateConfig(config.id, { provider: e.target.value })}
                                                className="ui-select"
                                            >
                                                <option value="OpenAI">OpenAI</option>
                                                <option value="Anthropic">Anthropic</option>
                                                <option value="Google">Google Gemini</option>
                                                <option value="DeepSeek">DeepSeek</option>
                                                <option value="Groq">Groq</option>
                                                <option value="OpenRouter">OpenRouter</option>
                                                <option value="Moonshot">Kimi (Moonshot)</option>
                                                <option value="Zhipu">Zhipu (GLM)</option>
                                                <option value="SiliconFlow">SiliconFlow</option>
                                                <option value="TogetherAI">Together AI</option>
                                                <option value="Custom">自定义 (Custom)</option>
                                            </select>
                                        </div>

                                        {/* Custom 必填 Base URL；其他 provider 可选填中转站地址 */}
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">
                                                Base URL {config.provider === "Custom" ? "（必填）" : "（可选，留空用官方端点）"}
                                                {config.provider === "Google" && (
                                                    <span style={{ color: "#888", marginLeft: 6, fontSize: "0.85em" }}>
                                                        中转站填 https://xxx/v1beta 走原生协议
                                                    </span>
                                                )}
                                            </label>
                                            <Input
                                                type="url"
                                                value={config.baseUrl || ""}
                                                onChange={(e) => updateConfig(config.id, { baseUrl: e.target.value })}
                                                placeholder={
                                                    config.provider === "Custom"
                                                        ? "https://api.example.com/v1"
                                                        : config.provider === "Google"
                                                            ? "https://your-proxy.example.com/v1beta"
                                                            : "默认用官方端点，留空即可"
                                                }
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">API Key</label>
                                            <Input
                                                type="password"
                                                value={config.apiKey}
                                                onChange={(e) => updateConfig(config.id, { apiKey: e.target.value })}
                                                placeholder="sk-..."
                                            />
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">默认模型 (Default Model)</label>
                                            {fetchedModels[config.id] && fetchedModels[config.id].length > 0 ? (
                                                <div className="flex flex-col gap-1.5">
                                                    <div className="relative">
                                                        <Search size={14} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-[var(--c-icon)]" />
                                                        <input
                                                            type="text"
                                                            value={modelQuery[config.id] || ""}
                                                            onChange={(e) => setModelQuery(prev => ({ ...prev, [config.id]: e.target.value }))}
                                                            placeholder="搜索已拉取的模型…"
                                                            className="ui-input w-full pl-8"
                                                        />
                                                    </div>
                                                    <select
                                                        value={config.defaultModel}
                                                        onChange={(e) => updateConfig(config.id, { defaultModel: e.target.value })}
                                                        className="ui-select flex-1"
                                                    >
                                                        <option value="">请选择模型...</option>
                                                        {filteredModels[config.id].map(m => (
                                                            <option key={m} value={m}>{m}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                            ) : (
                                                    <input
                                                        type="text"
                                                        value={config.defaultModel}
                                                        onChange={(e) => updateConfig(config.id, { defaultModel: e.target.value })}
                                                        placeholder="gpt-4o, claude-3-opus..."
                                                        className="ui-input flex-1"
                                                    />
                                                )}
                                            </div>

                                        <div className="flex gap-3 mt-1">
                                            <button
                                                onClick={() => fetchModels(config)}
                                                disabled={isFetching[config.id]}
                                                className="ui-btn ui-btn ui-btn-soft-action flex-1"
                                            >
                                                <RefreshCw size={16} className={isFetching[config.id] ? "animate-spin" : ""} />
                                                {isFetching[config.id] ? "拉取中..." : "拉取模型列表"}
                                            </button>

                                            <button
                                                onClick={() => testConnection(config)}
                                                disabled={isTesting[config.id]}
                                                className="ui-btn ui-btn ui-btn-success flex-1"
                                            >
                                                <Rss size={16} className={isTesting[config.id] ? "animate-spin" : ""} />
                                                {isTesting[config.id] ? "测试中..." : "测试连接"}
                                            </button>
                                        </div>

                                        {testResult[config.id] && testResult[config.id].message && (
                                            <Alert variant={testResult[config.id].success ? "success" : "danger"}>
                                                <AlertCircle size={16} className="mt-[2px] shrink-0" />
                                                <span className="break-all leading-[1.5]">{testResult[config.id].message}</span>
                                            </Alert>
                                        )}

                                        <div
                                            className="ui-toggle-row mt-2 overflow-visible"
                                            style={{ display: "block", position: "relative", height: "auto", flexShrink: 0, padding: "14px 76px 14px 16px" }}
                                        >
                                            <span className="menu-label font-medium">启用原生工具调用</span>
                                            <span className="menu-desc whitespace-normal break-words leading-[1.45]">
                                                开启后自动选择该服务商可用的原生工具格式（当前：{getNativeToolProtocolLabel(config)}）；关闭后使用文本动作协议。
                                            </span>
                                            <span style={{ position: "absolute", top: 0, bottom: 0, right: 16, display: "flex", alignItems: "center" }}>
                                                <Toggle
                                                    checked={config.enableNativeTools !== false}
                                                    onChange={(v) => updateConfig(config.id, { enableNativeTools: v })}
                                                />
                                            </span>
                                        </div>

                                        <div className="ui-toggle-row mt-2">
                                            <span className="menu-label font-medium">启用图像识别</span>
                                            <Toggle checked={config.enableImageRecognition} onChange={(v) => updateConfig(config.id, { enableImageRecognition: v })} />
                                        </div>

                                        <div className="ui-toggle-row mt-2">
                                            <span className="flex min-w-0 flex-col">
                                                <span className="menu-label font-medium">防胡言乱语</span>
                                                <span className="menu-desc">防止没有用户输入时胡言乱语</span>
                                            </span>
                                            <Toggle
                                                checked={config.preventEmptyGenerateRambling === true}
                                                onChange={(v) => updateConfig(config.id, { preventEmptyGenerateRambling: v })}
                                            />
                                        </div>

                                    </>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除配置后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeConfig(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
}

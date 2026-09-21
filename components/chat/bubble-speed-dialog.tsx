"use client";

import { useState } from "react";
import {
    calculateBubbleTypingDelayMs,
    DEFAULT_BUBBLE_TYPING_SPEED,
    INSTANT_BUBBLE_TYPING_SPEED,
    loadBubbleTypingSpeed,
    normalizeBubbleTypingSpeed,
    saveBubbleTypingSpeed,
    type BubbleTypingSpeed,
} from "@/lib/chat-storage";

/** 气泡发送速度的摘要文案（显示在设置入口右侧） */
export function describeBubbleTypingSpeed(speed?: BubbleTypingSpeed | null, customized?: boolean): string {
    if (!customized) return "默认（模拟打字）";
    const cfg = speed || DEFAULT_BUBBLE_TYPING_SPEED;
    if (cfg.maxMs <= 0) return "瞬时（不等待）";
    return `${(cfg.baseMs / 1000).toFixed(1)}s 起步 · 每字 ${cfg.perCharMs}ms`;
}

type PresetOption = {
    key: string;
    label: string;
    desc: string;
    value: BubbleTypingSpeed;
    /** true = 该档就是内置默认，应用时清掉自定义（跟随默认节奏） */
    followDefault: boolean;
};

const PRESET_OPTIONS: PresetOption[] = [
    { key: "instant", label: "瞬时", desc: "不等待，气泡一次全部发出", value: INSTANT_BUBBLE_TYPING_SPEED, followDefault: false },
    { key: "fast", label: "偏快", desc: "0.4 秒起步 · 每字 18ms", value: { baseMs: 400, perCharMs: 18, maxMs: 3000 }, followDefault: false },
    { key: "default", label: "默认（推荐）", desc: "0.8 秒起步 · 每字 35ms", value: DEFAULT_BUBBLE_TYPING_SPEED, followDefault: true },
    { key: "slow", label: "偏慢", desc: "1.5 秒起步 · 每字 70ms", value: { baseMs: 1500, perCharMs: 70, maxMs: 12000 }, followDefault: false },
];

function sameSpeed(a: BubbleTypingSpeed, b: BubbleTypingSpeed): boolean {
    return a.baseMs === b.baseMs && a.perCharMs === b.perCharMs && a.maxMs === b.maxMs;
}

/**
 * 全局「气泡发送速度」设置弹窗：所有会话公用一份节奏，
 * 只影响角色回复被拆成多条气泡时的逐条显示延迟，不改上下文、不改模型请求。
 */
export function BubbleSpeedDialog({ onClose }: { onClose: () => void }) {
    const [draft, setDraft] = useState<BubbleTypingSpeed>(() => loadBubbleTypingSpeed());

    const apply = (next: BubbleTypingSpeed | null) => {
        // 与内置默认一致时清掉自定义，摘要回到「默认（模拟打字）」
        const normalized = next ? normalizeBubbleTypingSpeed(next) : null;
        saveBubbleTypingSpeed(normalized && sameSpeed(normalized, DEFAULT_BUBBLE_TYPING_SPEED) ? null : normalized);
        onClose();
    };

    return (
        <div className="modal-overlay" onClick={onClose}>
            <div className="modal-dialog" onClick={e => e.stopPropagation()}>
                <span className="modal-header-title">气泡发送速度</span>
                <p className="menu-desc text-center !mt-0">
                    角色一次回复被拆成多条气泡时，逐条按此节奏延迟发出。全局设置，对所有会话生效；仅影响显示，不影响上下文。
                </p>
                <div className="flex flex-col gap-2 w-full">
                    {PRESET_OPTIONS.map(option => {
                        const active = sameSpeed(draft, option.value);
                        return (
                            <button
                                key={option.key}
                                type="button"
                                className={`ui-btn w-full flex-col ${active ? "ui-btn-primary" : "ui-btn-ghost"}`}
                                onClick={() => setDraft({ ...option.value })}
                            >
                                <span>{option.label}{active ? " ✓" : ""}</span>
                                <span className="ts-11 opacity-70">{option.desc}</span>
                            </button>
                        );
                    })}
                </div>
                <div className="w-full">
                    <div className="menu-desc text-left">自定义：起步延迟 / 每字追加 / 单条上限（毫秒）</div>
                    <div className="flex gap-2 mt-1.5">
                        <input
                            type="number"
                            min={0}
                            max={60000}
                            value={draft.baseMs}
                            onChange={e => setDraft(prev => ({ ...prev, baseMs: Number(e.target.value) || 0 }))}
                            className="ui-input flex-1 min-w-0 text-center"
                            placeholder="起步"
                        />
                        <input
                            type="number"
                            min={0}
                            max={5000}
                            value={draft.perCharMs}
                            onChange={e => setDraft(prev => ({ ...prev, perCharMs: Number(e.target.value) || 0 }))}
                            className="ui-input flex-1 min-w-0 text-center"
                            placeholder="每字"
                        />
                        <input
                            type="number"
                            min={0}
                            max={300000}
                            value={draft.maxMs}
                            onChange={e => setDraft(prev => ({ ...prev, maxMs: Number(e.target.value) || 0 }))}
                            className="ui-input flex-1 min-w-0 text-center"
                            placeholder="上限"
                        />
                    </div>
                    <div className="menu-desc text-left mt-1.5">
                        上限填 0 表示瞬时；示例：10 个字的气泡约等待{" "}
                        {calculateBubbleTypingDelayMs("十个字的气泡示例内容", draft)}ms
                    </div>
                </div>
                <div className="flex gap-3 w-full">
                    <button
                        type="button"
                        className="ui-btn ui-btn-ghost flex-1"
                        onClick={() => apply(null)}
                    >
                        恢复默认
                    </button>
                    <button
                        type="button"
                        className="ui-btn ui-btn-outline flex-1"
                        onClick={onClose}
                    >
                        取消
                    </button>
                    <button
                        type="button"
                        className="ui-btn ui-btn-success flex-1"
                        onClick={() => apply(draft)}
                    >
                        应用
                    </button>
                </div>
            </div>
        </div>
    );
}

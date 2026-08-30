"use client";

import { useLayoutEffect, type RefObject } from "react";

const CHAT_BOTTOM_RESERVE_CSS_VAR = "--chat-bottom-reserve";
const STICK_TO_BOTTOM_THRESHOLD = 120;

function findBottomOverlay(wrapper: HTMLElement): HTMLElement | null {
    for (const child of Array.from(wrapper.children)) {
        if (!(child instanceof HTMLElement)) continue;
        const ui = child.dataset.ui;
        if (ui === "input" || ui === "multi-select") return child;
    }
    return null;
}

export function useChatBottomReserve<TWrapper extends HTMLElement, TScroll extends HTMLElement>(
    wrapperRef: RefObject<TWrapper | null>,
    scrollRef: RefObject<TScroll | null>,
    refreshKey: string,
) {
    useLayoutEffect(() => {
        if (typeof window === "undefined") return;
        const wrapper = wrapperRef.current;
        if (!wrapper) return;

        let frame = 0;
        let bottomScrollFrame = 0;
        let observer: ResizeObserver | null = null;
        // 挂载时若用户尚未主动滚离底部，强制贴一次底（再贴几次直到稳定）
        // 解决：挂载瞬间 --chat-bottom-reserve 还没设上去 / 图片还没布局完成
        // → scrollHeight 比真实值小，初始滚动块读到的是旧值，滚不到底
        let initialStickFramesLeft = 6;

        const scheduleStickToBottom = () => {
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            bottomScrollFrame = window.requestAnimationFrame(() => {
                bottomScrollFrame = 0;
                const el = scrollRef.current;
                if (el) el.scrollTop = el.scrollHeight;
            });
        };

        // 仅在挂载初期连续几帧贴底（图片 decode / padding 变更稳定后停止）
        const scheduleInitialStickToBottom = () => {
            if (initialStickFramesLeft <= 0) return;
            initialStickFramesLeft -= 1;
            scheduleStickToBottom();
            if (initialStickFramesLeft > 0) {
                const el = scrollRef.current;
                if (!el) return;
                const r = window.requestAnimationFrame(scheduleInitialStickToBottom);
                void r;
            }
        };

        const measure = () => {
            frame = 0;
            const overlay = findBottomOverlay(wrapper);
            if (!overlay) {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
                return;
            }

            const el = scrollRef.current;
            const wasNearBottom = el
                ? el.scrollHeight - el.scrollTop - el.clientHeight < STICK_TO_BOTTOM_THRESHOLD
                : false;
            const height = Math.ceil(overlay.getBoundingClientRect().height);

            if (height > 0) {
                wrapper.style.setProperty(CHAT_BOTTOM_RESERVE_CSS_VAR, `${height}px`);
            } else {
                wrapper.style.removeProperty(CHAT_BOTTOM_RESERVE_CSS_VAR);
            }

            if (wasNearBottom) scheduleStickToBottom();
        };

        const requestMeasure = () => {
            if (frame) window.cancelAnimationFrame(frame);
            frame = window.requestAnimationFrame(measure);
        };

        const overlay = findBottomOverlay(wrapper);
        if (overlay && typeof ResizeObserver !== "undefined") {
            observer = new ResizeObserver(requestMeasure);
            observer.observe(overlay);
        }

        measure();
        // 挂载后立刻在接下来几帧连续贴底——挂载阶段 --chat-bottom-reserve 还没稳定、
        // 图片 decode 异步完成，scrollHeight 会随后增长；连续贴底能跟上。
        // 用户一旦主动滚动（见 scroll 事件处理）就停止。
        const el = scrollRef.current;
        let onUserScroll: (() => void) | null = null;
        if (el) {
            onUserScroll = () => {
                const sc = scrollRef.current;
                if (!sc) return;
                // 距离底部 > 阈值：用户已经主动滚走，停止强制贴底
                if (sc.scrollHeight - sc.scrollTop - sc.clientHeight > STICK_TO_BOTTOM_THRESHOLD) {
                    initialStickFramesLeft = 0;
                    sc.removeEventListener("scroll", onUserScroll!);
                }
            };
            el.addEventListener("scroll", onUserScroll, { passive: true });
            // 等一帧让初始滚动块先跑，再开始我们的贴底序列
            window.requestAnimationFrame(scheduleInitialStickToBottom);
        }
        window.addEventListener("resize", requestMeasure);
        window.visualViewport?.addEventListener("resize", requestMeasure);
        window.visualViewport?.addEventListener("scroll", requestMeasure);

        return () => {
            if (frame) window.cancelAnimationFrame(frame);
            if (bottomScrollFrame) window.cancelAnimationFrame(bottomScrollFrame);
            observer?.disconnect();
            if (onUserScroll) scrollRef.current?.removeEventListener("scroll", onUserScroll);
            window.removeEventListener("resize", requestMeasure);
            window.visualViewport?.removeEventListener("resize", requestMeasure);
            window.visualViewport?.removeEventListener("scroll", requestMeasure);
        };
    }, [wrapperRef, scrollRef, refreshKey]);
}

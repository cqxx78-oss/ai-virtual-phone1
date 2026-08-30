"use client";

type NavEntry = {
  id: number;
  tag?: string;
  onPop: () => void;
};

let nextId = 1;
const stack: NavEntry[] = [];
let initialized = false;

function initGlobalPopStateListener() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  window.addEventListener("popstate", (event) => {
    const navId = (event.state as { __navId?: number } | null)?.__navId;

    if (stack.length === 0) return;

    // 正常出栈：物理返回键回退到上一个历史条目
    const top = stack.pop();
    if (top) {
      try {
        top.onPop();
      } catch (err) {
        console.error("[NavStack] Error in onPop handler:", err);
      }
    }
  });
}

/**
 * 进入一个可回退的子页面 / 应用 / 弹层时调用。
 * 向浏览器历史栈压入一层记录，并注册回退时的回调。
 * 返回一个 cancel 函数，用于在组件非回退原因销毁时（例如强制卸载）自动清理栈。
 */
export function pushNav(onPop: () => void, tag?: string): () => void {
  if (typeof window === "undefined") return () => {};
  initGlobalPopStateListener();

  const entryId = nextId++;
  const entry: NavEntry = { id: entryId, tag, onPop };
  stack.push(entry);

  try {
    window.history.pushState({ __navId: entryId, tag }, "");
  } catch {}

  return () => {
    // 当组件通过 UI 正常状态切换卸载时（例如主动调用了 onBack/关闭），
    // 我们只把 entry 从我们的 JS 栈中移除，不要调用 history.back()，
    // 以免异步触发 popstate 造成二次回退误杀上一层！
    const idx = stack.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      stack.splice(idx, 1);
    }
  };
}

/**
 * 主动回退一层：供屏幕左上角的 UI 返回按钮统一调用。
 * 直接触发浏览器的 history.back()，让 popstate 统一分发 onPop，
 * 从而实现「点击虚拟返回键」与「手机物理返回键」100% 走完全一致的逻辑！
 */
export function popNav(): void {
  if (typeof window === "undefined") return;
  if (stack.length > 0) {
    window.history.back();
  }
}

/**
 * 检查当前是否有可返回的子层级
 */
export function hasNavLevels(): boolean {
  return stack.length > 0;
}

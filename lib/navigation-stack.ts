"use client";

type NavEntry = {
  id: number;
  tag?: string;
  onPop: () => void;
};

let nextId = 1;
const stack: NavEntry[] = [];
let initialized = false;
let isNavigatingBack = false;

function initGlobalPopStateListener() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  window.addEventListener("popstate", () => {
    if (stack.length > 0) {
      const top = stack.pop();
      if (top) {
        try {
          isNavigatingBack = true;
          top.onPop();
        } finally {
          isNavigatingBack = false;
        }
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
    // 如果是物理返回/popstate 触发的回调导致的组件卸载，栈顶已经在 popstate 事件里被 pop 掉了，无需重复处理
    if (!isNavigatingBack) {
      const idx = stack.findIndex(e => e.id === entryId);
      if (idx !== -1) {
        // 只有当被手动关闭的是当前栈顶时，才调用 history.back() 弹出该历史条目
        // 此时 history.back() 触发的 popstate 会因为栈里已经没有该 entry 而不会误触发额外的 onPop
        const isTop = (idx === stack.length - 1);
        stack.splice(idx, 1);
        if (isTop) {
          try {
            isNavigatingBack = true;
            window.history.back();
          } catch {} finally {
            isNavigatingBack = false;
          }
        }
      }
    }
  };
}

/**
 * 主动回退一层（等同于点击虚拟返回按钮），会触发浏览器 history.back()，进而触发 popstate 和 onPop。
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

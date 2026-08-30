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

  window.addEventListener("popstate", (event) => {
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
    // 如果当前不是因为用户物理返回/popstate 触发的卸载，而是组件自己卸载或手动关闭
    if (!isNavigatingBack) {
      const idx = stack.findIndex(e => e.id === entryId);
      if (idx !== -1) {
        stack.splice(idx, 1);
        // 只有当被移除的是当前栈顶时才调用 history.back() 弹出该历史条目
        if (idx === stack.length) {
          try {
            window.history.back();
          } catch {}
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

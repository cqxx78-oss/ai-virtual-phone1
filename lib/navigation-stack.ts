"use client";

type NavEntry = {
  id: number;
  tag?: string;
  onPop: () => void;
};

let nextId = 1;
const stack: NavEntry[] = [];
let initialized = false;
let desktopExitHandler: (() => void) | null = null;

function initGlobalPopStateListener() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  // 桌面初始化时，向浏览器压入一个根底帧，用于捕获在桌面上按返回键的行为，防止直接退出 PWA
  try {
    window.history.pushState({ __isDesktopRoot: true }, "");
  } catch {}

  window.addEventListener("popstate", (event) => {
    if (stack.length > 0) {
      // 导航栈中有层级：按顺序正常出栈回退上一层（聊天室→列表、子页面→主页、应用→桌面等）
      const top = stack.pop();
      if (top) {
        try {
          top.onPop();
        } catch (err) {
          console.error("[NavStack] Error in onPop handler:", err);
        }
      }
    } else {
      // 栈已空（当前已经在小手机桌面上）：
      // 重新推入底帧保持在当前页，并触发退出确认弹窗，防止误触直接退出 PWA
      try {
        window.history.pushState({ __isDesktopRoot: true }, "");
      } catch {}
      if (desktopExitHandler) {
        desktopExitHandler();
      }
    }
  });
}

/**
 * 注册在小手机桌面按返回键时的拦截确认回调
 */
export function registerDesktopExitHandler(handler: (() => void) | null): () => void {
  desktopExitHandler = handler;
  if (typeof window !== "undefined") {
    initGlobalPopStateListener();
  }
  return () => {
    if (desktopExitHandler === handler) desktopExitHandler = null;
  };
}

/**
 * 进入一个可回退的子页面 / 应用 / 弹层时调用。
 * 向浏览器历史栈压入一层记录，并注册回退时的回调。
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
    const idx = stack.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      stack.splice(idx, 1);
    }
  };
}

/**
 * 主动回退一层：供屏幕左上角的 UI 返回按钮统一调用。
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

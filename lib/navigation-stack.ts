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
let isInternalPopping = false;

function initGlobalPopStateListener() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  // 桌面初始化时，向浏览器压入基础底帧与哨兵防穿透帧
  try {
    window.history.replaceState({ nav: 0, __isDesktopRoot: true }, "");
    window.history.pushState({ nav: 0, __isDesktopRoot: true }, "");
  } catch {}

  window.addEventListener("popstate", (event) => {
    // 如果是内部程序同步调用引发的尾随事件，直接放行，不吞噬任何用户物理按键
    if (isInternalPopping) {
      isInternalPopping = false;
      return;
    }

    // 【底座绝对锁死】：只要历史被按穿到了最底部（无有效状态或为 0），瞬间无条件推入哨兵帧补齐，
    // 永远保证浏览器里有一张“免死金牌”上一页，物理层面上 100% 杜绝安卓系统直接关闭小手机应用！
    if (!event.state || typeof event.state.nav !== "number" || event.state.nav <= 0) {
      try {
        window.history.pushState({ nav: Math.max(0, stack.length - 1), __isDesktopRoot: true }, "");
      } catch {}
    }

    // 每次物理按键回退，只优雅出栈一层，杜绝“连按两下直接全退光”
    if (stack.length > 0) {
      const top = stack.pop();
      if (top) {
        try {
          top.onPop();
        } catch (err) {
          console.error("[NavStack] Error in onPop handler:", err);
        }
      }
    } else {
      // 栈已经完全处于桌面根层，按返回键弹窗询问，且锁在当前页
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

  // 压入当前层级深度 nav，供 popstate 定深同步与防漂移对齐
  try {
    window.history.pushState({ nav: stack.length, __navId: entryId, tag }, "");
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
 * 立刻同步出栈并执行 onPop()，界面 100% 秒级跟手，同时安全同步历史记录。
 */
export function popNav(): void {
  if (typeof window === "undefined") return;
  if (stack.length > 0) {
    const top = stack.pop();
    if (top) {
      try {
        top.onPop();
      } catch (err) {
        console.error("[NavStack] Error in immediate onPop handler:", err);
      }
    }
    isInternalPopping = true;
    try {
      window.history.back();
    } catch {
      isInternalPopping = false;
    }
  }
}

/**
 * 检查当前是否有可返回的子层级
 */
export function hasNavLevels(): boolean {
  return stack.length > 0;
}

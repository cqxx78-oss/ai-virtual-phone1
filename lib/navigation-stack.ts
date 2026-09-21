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
let pendingProgrammaticPops = 0;

function initGlobalPopStateListener() {
  if (typeof window === "undefined" || initialized) return;
  initialized = true;

  // 桌面初始化时，向浏览器压入一个根底帧（nav: 0），用于捕获在桌面上按返回键的行为，防止直接退出 PWA
  try {
    window.history.replaceState({ nav: 0, __isDesktopRoot: true }, "");
    window.history.pushState({ nav: 0, __isDesktopRoot: true }, "");
  } catch {}

  window.addEventListener("popstate", (event) => {
    // 如果是程序主动 popNav() 引起的历史回退，直接消耗配额，不再重复触发页面回退
    if (pendingProgrammaticPops > 0) {
      pendingProgrammaticPops--;
      return;
    }

    // 读取浏览器历史当前的目标深度；没有状态或根层时目标深度为 0
    let targetDepth = typeof event.state?.nav === "number" ? event.state.nav : 0;

    // 前进场景钳制：若用户按了浏览器前进键，不盲目扩张栈，保证安全不越界
    if (targetDepth > stack.length) {
      targetDepth = stack.length;
    }

    const initialStackLength = stack.length;

    // 目标深度收敛：只要当前栈深大于目标深度，依次平稳出栈回退，根除跳级与多级错位
    while (stack.length > targetDepth) {
      const top = stack.pop();
      if (top) {
        try {
          top.onPop();
        } catch (err) {
          console.error("[NavStack] Error in onPop handler:", err);
        }
      }
    }

    // 只有在【按键前本身就已经在桌面根层】时按返回，才触发退出确认；
    // 如果刚才执行了出栈（刚从 App 退回桌面），绝不弹窗误触。
    if (initialStackLength === 0 && stack.length === 0 && targetDepth === 0) {
      try {
        window.history.pushState({ nav: 0, __isDesktopRoot: true }, "");
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

  // 压入当前层级深度 nav，供 popstate 定深同步与防漂移对齐
  try {
    window.history.pushState({ nav: stack.length, __navId: entryId, tag }, "");
  } catch {}

  return () => {
    const idx = stack.findIndex(e => e.id === entryId);
    if (idx !== -1) {
      const isTop = idx === stack.length - 1;
      stack.splice(idx, 1);
      // 若组件因内部其他交互直接卸载且当前位于栈顶，顺便将浏览器的冗余死帧撤回，杜绝死帧堆积
      if (isTop) {
        pendingProgrammaticPops++;
        try {
          window.history.back();
        } catch {}
      }
    }
  };
}

/**
 * 主动回退一层：供屏幕左上角的 UI 返回按钮统一调用。
 * 核心优化：立刻同步执行栈顶的 onPop() 保证界面 100% 毫秒级秒退，
 * 同时向浏览器发出 history.back() 抹平浏览器历史记录，杜绝“点好几下没反应”。
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
    pendingProgrammaticPops++;
    try {
      window.history.back();
    } catch {}
  }
}

/**
 * 检查当前是否有可返回的子层级
 */
export function hasNavLevels(): boolean {
  return stack.length > 0;
}

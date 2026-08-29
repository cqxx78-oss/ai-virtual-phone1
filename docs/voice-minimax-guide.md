# MiniMax 音色维护与分类配置指引

本文档记录了系统中 MiniMax 语音音色的内置列表、分类逻辑及修改维护规范，便于后续快速增删音色或调整分类归属。

---

## 1. 核心代码文件与定位

音色相关的逻辑集中在以下两个文件中：

| 文件路径 | 职责说明 | 关键定位代码 |
| :--- | :--- | :--- |
| `components/settings/voice-settings.tsx` | 前端音色面板、内置预设列表、分类展示与收藏逻辑 | `DEFAULT_MINIMAX_VOICES`（内置预设音色库）<br>`isEnglishVoiceId` / `isCantoneseVoice`（分类规则） |
| `app/api/voice/minimax-voices/route.ts` | 服务端代理 MiniMax 官方接口（`/v1/get_voice`）获取全量音色 | `extractAllVoices`（解析官方接口并标记 category） |

---

## 2. 内置预设音色维护（修改 / 新增）

**定位位置**：`components/settings/voice-settings.tsx` 中的 `DEFAULT_MINIMAX_VOICES` 数组。

### 数据格式：
```ts
{ id: "音色ID", name: "展示名称 (音色ID)", category: "system" }
```

### 规范注意：
1. **ID 字符严格对齐**：MiniMax 官方部分 ID 含有全角/半角特殊字符（例如 `Cantonese_ProfessionalHost（F)` 左括号是全角 `（`，右括号是半角 `)`），必须严格按照官方文档一致，避免拉取后因字符差异重复显示。
2. **名称格式**：统一为 `中文名称 (音色ID)`，与接口动态拉取的格式保持一致。

---

## 3. 分类判定逻辑（修改音色所属 Tab）

**定位位置**：`components/settings/voice-settings.tsx` 中的音色分组过滤函数。

当前音色选择面板共有 5 个固定 Tab：
1. **⭐ 收藏 (`fav`)**：读取本地 `favorite_voices_cache` 存储。
2. **🗣️ 普通话 (`mandarin`)**：默认所有非粤语、非外语的系统音色。
3. **🇭🇰 粤语 (`cantonese`)**：满足 `isCantoneseVoice` 判定（`id.startsWith("Cantonese_")` 或 `name.includes("粤语")`）。
4. **🌐 英语/外语 (`foreign`)**：满足 `isEnglishVoiceId(id)` 白名单，或判定为纯英文非汉语拼音音色。
5. **🎙️ 克隆/文生 (`custom`)**：满足 `isCloningOrGen` 判定（`category === "cloning" || category === "generation"`，或 ID 以前缀 `voice_` / `ttv-` 开头）。

### 调整某个音色分类的快捷方法：
* **将某个音色移入「英语/外语」**：在 `isEnglishVoiceId` 的 `Set` 中加入该音色的 `id` 字符串；
* **将某个音色移入「普通话」**：如果被误识别为外语，从 `isEnglishVoiceId` 中移除，或确保名称包含中文描述；
* **将某个音色移入「粤语」**：确保 ID 以 `Cantonese_` 开头，或名称包含 `粤语`。

---

## 4. MiniMax 官方参考文档
* [MiniMax 官方系统音色列表](https://platform.minimaxi.com/docs/faq/system-voice-id)
* [MiniMax 查询可用音色接口 (get_voice)](https://platform.minimaxi.com/docs/api-reference/voice-management-get)

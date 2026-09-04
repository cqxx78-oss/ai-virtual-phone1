# 云相册开发记录

更新时间：2026-03-04

## 当前目标

继续完善自定义 APP「云相册」：云端图片浏览、分组管理、收藏、批量归类、图片预览、备注、下载、发送和回收站。

## 已完成的界面调整

- 相册列表页使用少量圆角：CSS 变量当前约为 `3px` / `4px`。
- 图片网格间距已缩小：窄屏约 `2px`，较宽屏约 `3px`。
- 顶部操作按钮已隐藏，主要操作移动到屏幕底部菜单。
- 底部菜单采用图标在上、文字在下的布局，当前包括：
  - 上传
  - 新建分组
  - 刷新
  - 批量分组
  - 服务器设置
- 列表页右上角增加「...」更多入口，目前包含「服务器设置」。
- 顶部分组栏最右侧增加 `+`，点击打开新建分组弹窗。
- 分组栏支持左右滑动切换分组。
- 相册列表不显示图片文件名标签，预览页也不显示 `xxx.png` 文件名。

## 分组与收藏

- 云端接口仍使用：
  - `GET /categories`
  - `POST /category`
  - `PUT /photo/{id}/category`
- 启动时确保存在「回收站」分组。
- 启动时确保存在「收藏」分组，并保存 `favoriteCategoryId`。
- 收藏的本质是把图片的 `categoryId` 改为服务器上的「收藏」分组 ID，不再使用本地布尔收藏标记。
- 分组栏显示：全部、收藏、未分组、自定义分组、回收站以及右侧新建按钮。
- 批量分组交互目标：
  1. 点击「批量分组」进入选择模式；按钮文字变为「添加到」。
  2. 点击多张图片进行选择。
  3. 点击「添加到」打开分组列表弹窗。
  4. 选择目标分组后，点击弹窗「确认」才真正提交。
  5. 点击「取消」退出并恢复「批量分组」文字。
- 单张移动分组已从主操作区移到预览页「更多」菜单。

## 图片预览页

- 背景已经改为白色。
- 图片位于顶部区域和底部操作区之间，使用 `object-fit: contain`，最大宽度/高度不超过可用区域。
- 支持左右直接滑动切换图片，不使用渐进渐出效果。
- 支持向下滑动返回相册列表。
- 左上角叉号按钮已隐藏，返回主要依靠向下滑动和宿主返回操作。
- 预览顶部有备注文本框：点击后可编辑，`change` 时保存。
- 备注数据使用 APP 私有 IndexedDB 表 `photo_meta` 保存，字段至少包括 `photoId`、`note`。
- 读取本地备注时只合并 `note`，不能把本地记录整体 `Object.assign` 到服务器照片对象，否则会覆盖服务器图片 `id` 并导致图片白屏。
- 预览主操作当前设计为：收藏、发送、删除（移入回收站）、更多。
- 「下载原图」已移动到「更多」菜单。
- 「更多」菜单包含：
  - 移动分组
  - 图片信息
  - 下载原图
  - 复制 WebP 链接
- 更多菜单已改为 `position: fixed`，避免被底部横向操作区裁切。

## 发送功能

- 当前协议明确支持角色列表和角色聊天：
  - `AiPhone.characters.list()`
  - `AiPhone.chat.sendCard()`
  - `AiPhone.chat.openConversation()`
- 发送入口当前可选择一个角色，并发送相册图片卡片到该角色聊天。
- 群聊列表和群聊发送接口在 APP 创作指南中没有公开，不能假设存在；后续如需群聊发送，应先确认宿主 SDK 是否新增接口。
- 图片分享使用云端 WebP 地址：
  `GET /image/{id}?width=1200&format=webp&quality=85`
- 下载原图使用：
  `GET /raw/{filename}`

## 服务器与本地数据

- 默认服务器：`https://api.p2ino.info:8443`
- 自定义服务器地址保存于 APP 私有数据表 `settings`，字段为 `apiBase`。
- 新建分组和服务器地址弹窗不自动 `focus()`，避免打开时自动弹出手机键盘。
- APP 权限目前为：
  - `app.data.read`
  - `app.data.write`
  - `network.fetch`
  - `ui.toast`
- 云相册仍是单文件 APP，无附带资源。

## 重要的后续检查项

1. **先打开 APP 做实际点击测试**：重点测试更多、发送、下载、移动分组、收藏和批量确认。
2. 检查预览页 HTML 中是否存在重复的 `id`。尤其是 `btnDownloadRaw`、`btnCopyWebp`、`btnMoveGroup`，同一页面只能各有一个。
3. 当前 `groupPicker` 已从 `<select>` 改成按钮列表，确认弹窗按钮 `groupConfirm` 可见，并且选择分组后需要再次点击确认提交。
4. 批量分组和单张移动应共用同一个提交函数，避免一个流程点击分组立即提交、另一个流程需要确认。
5. 目前 `moveTargetsToGroup()` 成功后会清空选择状态并恢复底部按钮文字；取消弹窗也应恢复文字和选择状态。
6. 当前预览页下载按钮应只存在于「更多」菜单，主操作栏不能再出现第二个同 ID 的下载按钮。
7. 图片自适应重点检查：`.lb-body` 应保持 `flex: 1; min-height: 0`，`.lb-img` 应使用 `max-width: 100%; max-height: 100%; object-fit: contain`。
8. 若再次出现图片白屏，第一时间检查图片 URL 中的服务器照片 ID 是否被本地 `photo_meta` 数据覆盖。
9. APP 当前通过编辑已安装内容直接修改；如要生成可安装包，需要先将最终源码写入 APP 暂存区，再执行发布。

## 关键源码位置

- 本机 APP 名称：`云相册`
- 入口文件：`index.html`
- 主要状态变量：`currentTab`、`photos`、`currentFiltered`、`categories`、`trashCategoryId`、`favoriteCategoryId`、`selectionMode`、`selectedPhotoIds`
- 主要函数：`ensureTrashCategory()`、`renderCatBar()`、`renderPhotos()`、`updateLightboxContent()`、`openLightbox()`、`moveTargetsToGroup()`、`openGroupModal()`、`handleFilesSelected()`

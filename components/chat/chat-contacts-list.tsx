"use client";

import React, { useState, useEffect, useCallback, useRef, useMemo, useDeferredValue, useSyncExternalStore } from "react";
import { loadChatContacts, ChatContact, createOrGetSession, ChatSession, addChatContact, pushChatMessage, loadChatMessages } from "@/lib/chat-storage";
import { resolveUserIdentity } from "@/lib/settings-storage";
import { PENDING_REPLY_PREFIX } from "@/lib/friend-request-engine";
import { loadCharacters } from "@/lib/character-storage";
import { Character } from "@/lib/character-types";
import { loadMomentPosts } from "@/lib/moments-storage";
import {
    getPendingFriendRequests,
    clearRequestsForCharacter,
    updateFriendRequestStatus,
    dispatchFriendRequestUpdated,
    type FriendRequest,
} from "@/lib/friend-request-storage";
import { handleAcceptFriendRequest, triggerRejectReaction } from "@/lib/friend-request-engine";
import { PageShell } from "@/components/ui/page-shell";
import { pinyin } from "pinyin-pro";
import { kvSet } from "@/lib/kv-db";
import { scrollElementWithinContainer } from "@/lib/dom-scroll";
import { ChatFallbackAvatar } from "./chat-fallback-avatar";
import {
    DEFAULT_MASCOT_AVATAR,
    getMascotSettingsSnapshot,
    resolveMascotImageRef,
    subscribeMascotSettings,
    updateMascotSettings,
} from "@/lib/mascot-settings";

type ChatContactsListProps = {
    onCloseApp: () => void;
    onSelectSession: (session: ChatSession | null) => void;
    onSelectMascot: () => void;
    /** 名片点击「加好友」：切到本 tab 后待打开添加页的角色 id */
    pendingAddContactId?: string | null;
    onPendingAddContactConsumed?: () => void;
    /** 名片来源的添加页按返回时回到原聊天室 */
    onPendingAddContactBack?: () => void;
};

export function ChatContactsList({ onCloseApp, onSelectSession, onSelectMascot, pendingAddContactId, onPendingAddContactConsumed, onPendingAddContactBack }: ChatContactsListProps) {
    const [contacts, setContacts] = useState<(ChatContact & { char?: Character })[]>([]);
    const [contactFilter, setContactFilter] = useState("");
    const [latestPost, setLatestPost] = useState<Record<string, string>>({});
    const [pendingRequests, setPendingRequests] = useState<FriendRequest[]>([]);
    const [showRequestList, setShowRequestList] = useState(false);
    const [selectedRequest, setSelectedRequest] = useState<FriendRequest | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [isAddFriendOpen, setIsAddFriendOpen] = useState(false);
    const [addQuery, setAddQuery] = useState("");
    const [addResult, setAddResult] = useState<Character | null | undefined>(undefined);
    const [isSendingAdd, setIsSendingAdd] = useState(false);
    const [greetingText, setGreetingText] = useState("");
    // 添加页是否由名片打开：返回时应回到原聊天室而非联系人列表
    const addFromCardRef = useRef(false);
    const mascotSettings = useSyncExternalStore(subscribeMascotSettings, getMascotSettingsSnapshot, getMascotSettingsSnapshot);
    const [mascotAvatarUrl, setMascotAvatarUrl] = useState(mascotSettings.avatarImage || DEFAULT_MASCOT_AVATAR);

    const identity = useMemo(() => resolveUserIdentity(), []);
    const chars = useMemo(() => loadCharacters(), []);
    const deferredContactFilter = useDeferredValue(contactFilter);
    const bodyRef = useRef<HTMLDivElement>(null);
    const sectionRefs = useRef<Record<string, HTMLDivElement | null>>({});

    useEffect(() => {
        let cancelled = false;
        resolveMascotImageRef(mascotSettings.avatarImage).then((url) => {
            if (!cancelled) setMascotAvatarUrl(url);
        });
        return () => { cancelled = true; };
    }, [mascotSettings.avatarImage]);

    // 名片点击「添加到通讯录」：phone-chat-app 切到本 tab 后由 prop 传入待添加角色，
    // 打开添加页并预载资料（本组件仅在 tab 激活时挂载，不能直接监听事件）
    useEffect(() => {
        if (!pendingAddContactId) return;
        const found = loadCharacters().find(c => c.id === pendingAddContactId);
        onPendingAddContactConsumed?.();
        if (!found) return;
        addFromCardRef.current = true;
        setIsAddFriendOpen(true);
        setAddQuery(found.wechatID || found.id);
        setAddResult(found);
        setIsSendingAdd(false);
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [pendingAddContactId]);

    /** Get the pinyin initial letter (uppercase A-Z), fallback to # */
    function getInitial(name: string): string {
        if (!name) return "#";
        const first = name.charAt(0);
        // Already A-Z or a-z
        if (/[a-zA-Z]/.test(first)) return first.toUpperCase();
        // Chinese → pinyin
        const py = pinyin(first, { toneType: "none", type: "array" });
        if (py.length > 0 && /[a-zA-Z]/.test(py[0].charAt(0))) {
            return py[0].charAt(0).toUpperCase();
        }
        return "#";
    }

    const refresh = useCallback(() => {
        const rawContacts = loadChatContacts();
        const enriched = rawContacts.map(c => ({
            ...c,
            char: chars.find(ch => ch.id === c.characterId)
        })).filter(c => c.char);
        enriched.sort((a, b) => (a.char?.name || "").localeCompare(b.char?.name || ""));
        setContacts(enriched);

        const posts = loadMomentPosts();
        const map: Record<string, string> = {};
        for (const p of posts) {
            if (!map[p.authorId]) map[p.authorId] = p.content;
        }
        setLatestPost(map);

        setPendingRequests(getPendingFriendRequests());
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
        refresh();
        const handler = () => refresh();
        window.addEventListener("friend-requests-updated", handler);
        return () => window.removeEventListener("friend-requests-updated", handler);
    }, [refresh]);

    /** Group contacts by pinyin initial */
    const { grouped, indexLetters } = useMemo(() => {
        const keyword = deferredContactFilter.trim().toLowerCase();
        const filtered = keyword
            ? contacts.filter(c => (c.char?.name || "").toLowerCase().includes(keyword))
            : contacts;
        const map: Record<string, typeof contacts> = {};
        for (const c of filtered) {
            const letter = getInitial(c.char?.name || "");
            (map[letter] ??= []).push(c);
        }
        // Sort keys: A-Z first, then #
        const sorted = Object.keys(map).sort((a, b) => {
            if (a === "#") return 1;
            if (b === "#") return -1;
            return a.localeCompare(b);
        });
        return { grouped: map, indexLetters: sorted };
    // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [contacts, deferredContactFilter]);

    const handleAccept = async (req: FriendRequest) => {
        setIsProcessing(true);
        try {
            const session = await handleAcceptFriendRequest(req.characterId, req.message);
            setSelectedRequest(null);
            setShowRequestList(false);
            refresh();
            onSelectSession(session);
        } catch (err) {
            console.warn("[Contacts] Accept friend request failed:", err);
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async (req: FriendRequest) => {
        setIsProcessing(true);
        try {
            updateFriendRequestStatus(req.id, "rejected");
            dispatchFriendRequestUpdated();
            setSelectedRequest(null);

            // Trigger AI's next attempt (fire-and-forget)
            triggerRejectReaction(req.characterId).catch(() => {});
            refresh();
        } finally {
            setIsProcessing(false);
        }
    };

    const getCharForRequest = (req: FriendRequest) =>
        chars.find(c => c.id === req.characterId);

    return (
        <div className="relative flex-1 h-full">
            <PageShell
                title="Contacts"
                onBack={onCloseApp}
                bodyRef={bodyRef}
            >
            <div className="px-5">
                {/* Search bar */}
                <div className="pt-5 pb-3">
                    <div className="chat-search-bar">
                        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--c-icon)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
                        <input
                            className="chat-search-input ts-15 w-full bg-transparent outline-none text-[var(--c-text-title)] placeholder:text-[var(--c-icon)]"
                            placeholder="Search contacts..."
                            value={contactFilter}
                            onChange={(e) => setContactFilter(e.target.value)}
                        />
                    </div>
                </div>

                {mascotSettings.chatEnabled && (
                    <div className="mb-3">
                        <div className="minimal-list-item" onClick={onSelectMascot}>
                            <div className="minimal-avatar-wrapper bg-white">
                                <img src={mascotAvatarUrl} className="w-full h-full object-contain rounded-full p-[2px]" alt="" />
                                <span className="minimal-online-dot" />
                            </div>
                            <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                                <div className="ts-16 font-medium text-[var(--c-text-title)] truncate">{mascotSettings.nickname || "AI助手"}</div>
                                <div className="ts-13 text-[var(--c-text)] opacity-80 truncate font-normal">内置创作助手</div>
                            </div>
                        </div>
                    </div>
                )}

                {/* Contacts list grouped by pinyin initial */}
                {contacts.length === 0 ? (
                    <div className="ui-empty">
                        <span className="menu-desc">暂无联系人，去消息页右上角添加吧</span>
                    </div>
                ) : (
                    <div className="flex flex-col gap-1">
                        {indexLetters.map(letter => (
                            <div key={letter} ref={el => { sectionRefs.current[letter] = el; }} className="flex flex-col gap-0">
                                <div className="contact-letter-header text-[var(--c-icon)] py-2 ts-13 pl-1 font-semibold">{letter}</div>
                                {grouped[letter].map(c => {
                                    const char = c.char!;
                                    return (
                                        <div
                                            key={c.id}
                                            onClick={() => {
                                                const sess = createOrGetSession(char.id);
                                                onSelectSession(sess);
                                            }}
                                            className="minimal-list-item"
                                        >
                                            <div className="minimal-avatar-wrapper">
                                                {char.avatar ? (
                                                    <img src={char.avatar} className="w-full h-full object-cover rounded-full" alt="" />
                                                ) : (
                                                    <ChatFallbackAvatar className="rounded-full" />
                                                )}
                                            </div>
                                            <div className="flex-1 overflow-hidden h-[48px] flex flex-col justify-center gap-1">
                                                <div className="ts-16 font-medium text-[var(--c-text-title)] truncate">
                                                    {char.name || "UNNAMED"}
                                                </div>
                                                <div className="ts-13 text-[var(--c-text)] opacity-80 truncate font-normal">
                                                    {latestPost[char.id] || "暂无动态"}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })}
                            </div>
                        ))}
                    </div>
                )}
            </div>

            {/* Quick-jump letter index on the right */}
            {indexLetters.length > 1 && (
                <div className="contact-alpha-index">
                    {indexLetters.map(letter => (
                        <span
                            key={letter}
                            className="contact-alpha-letter"
                            onClick={() => {
                                const target = sectionRefs.current[letter];
                                const container = bodyRef.current;
                                if (target && container) {
                                    scrollElementWithinContainer(container, target, { behavior: "smooth", block: "start" });
                                }
                            }}
                        >
                            {letter}
                        </span>
                    ))}
                </div>
            )}
            </PageShell>

            {/* Friend Request List Modal */}
            {showRequestList && (
                <div className="modal-overlay" onClick={() => setShowRequestList(false)}>
                    <div className="modal-dialog freq-dialog" onClick={e => e.stopPropagation()}>
                        <div className="flex items-center justify-between pb-3 border-b border-[var(--c-card-border)]">
                            <span className="ts-16 font-bold text-[var(--c-text-title)]">新的朋友</span>
                            <button onClick={() => setShowRequestList(false)} className="ui-bare-btn text-[var(--c-icon)] ts-14">关闭</button>
                        </div>

                        <div className="freq-list">
                            {pendingRequests.map(req => {
                                const char = getCharForRequest(req);
                                return (
                                    <div
                                        key={req.id}
                                        className="freq-list-item"
                                        onClick={() => setSelectedRequest(req)}
                                    >
                                        <div className="freq-avatar">
                                            {char?.avatar ? (
                                                <img src={char.avatar} alt="" />
                                            ) : (
                                                <div className="freq-avatar-fallback">
                                                    {char?.name?.charAt(0) || "?"}
                                                </div>
                                            )}
                                        </div>
                                        <div className="flex-1 overflow-hidden">
                                            <div className="ts-14 font-medium text-[var(--c-text-title)] truncate">
                                                {char?.name || "未知角色"}
                                            </div>
                                            <div className="ts-12 text-[var(--c-icon)] truncate mt-0.5">
                                                {req.message || "请求添加你为好友"}
                                            </div>
                                        </div>
                                        <span className="ts-12 text-[var(--c-action-blue,#246bfd)] font-medium shrink-0">查看</span>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                </div>
            )}

            {/* Friend Request Detail Modal */}
            {selectedRequest && (
                <div className="modal-overlay" onClick={() => !isProcessing && setSelectedRequest(null)}>
                    <div className="modal-dialog freq-dialog" onClick={e => e.stopPropagation()}>
                        {(() => {
                            const char = getCharForRequest(selectedRequest);
                            return (
                                <div className="flex flex-col items-center gap-4 py-2">
                                    <div className="freq-detail-avatar">
                                        {char?.avatar ? (
                                            <img src={char.avatar} alt="" />
                                        ) : (
                                            <div className="freq-avatar-fallback text-xl">
                                                {char?.name?.charAt(0) || "?"}
                                            </div>
                                        )}
                                    </div>

                                    <div className="text-center">
                                        <div className="ts-16 font-bold text-[var(--c-text-title)]">{char?.name || "未知角色"}</div>
                                        {char?.persona && (
                                            <div className="ts-12 text-[var(--c-icon)] mt-1 max-w-[240px] truncate">{char.persona}</div>
                                        )}
                                    </div>

                                    <div className="freq-detail-msg">
                                        &ldquo;{selectedRequest.message || "请求添加你为好友"}&rdquo;
                                    </div>

                                    <div className="flex gap-3 w-full mt-2">
                                        <button
                                            onClick={() => handleReject(selectedRequest)}
                                            disabled={isProcessing}
                                            className="ui-btn ui-btn-outline flex-1"
                                        >
                                            拒绝
                                        </button>
                                        <button
                                            onClick={() => handleAccept(selectedRequest)}
                                            disabled={isProcessing}
                                            className="ui-btn ui-btn-primary flex-1"
                                        >
                                            {isProcessing ? "处理中..." : "同意"}
                                        </button>
                                    </div>
                                </div>
                            );
                        })()}
                    </div>
                </div>
            )}

            {/* Add Friend Search Modal */}
            {isAddFriendOpen && (
                <div style={{ position: 'absolute', inset: 0, zIndex: 9999, background: '#ffffff' }}>
                <div style={{ position: 'absolute', inset: 0, background: 'var(--c-page-body-bg)' }}>
                <PageShell
                    title="添加朋友"
                    onBack={() => {
                        setIsAddFriendOpen(false);
                        if (addFromCardRef.current) {
                            addFromCardRef.current = false;
                            onPendingAddContactBack?.();
                        }
                    }}
                >

                    {!addResult && addResult !== null && (
                        <div className="page-menu">
                            <div className="menu-group">
                                <div className="menu-item">
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="var(--c-icon)" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" className="shrink-0"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                    <input
                                        autoFocus
                                        placeholder="微信号/手机号"
                                        value={addQuery}
                                        onChange={(e) => {
                                            setAddQuery(e.target.value);
                                            setAddResult(undefined);
                                        }}
                                        className="ui-input ui-input-inline"
                                    />
                                    {addQuery && (
                                        <button onClick={() => setAddQuery("")} className="ui-bare-btn text-[var(--c-icon)]">
                                            <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor"><path d="M12 2C6.47 2 2 6.47 2 12s4.47 10 10 10 10-4.47 10-10S17.53 2 12 2zm5 13.59L15.59 17 12 13.41 8.41 17 7 15.59 10.59 12 7 8.41 8.41 7 12 10.59 15.59 7 17 8.41 13.41 12 17 15.59z" /></svg>
                                        </button>
                                    )}
                                </div>

                                {addQuery.trim().length > 0 && (
                                    <div
                                        onClick={() => {
                                            const q = addQuery.trim().toLowerCase();
                                            const chars = loadCharacters();
                                            const found = chars.find(c =>
                                                (c.wechatID && c.wechatID.toLowerCase() === q) ||
                                                (c.id && c.id.toLowerCase() === q)
                                            );
                                            setAddResult(found || null);
                                        }}
                                        className="menu-item cursor-pointer border-t border-[var(--c-card-border)] !py-3"
                                    >
                                        <div className="w-[36px] h-[36px] rounded-[6px] bg-[var(--c-action-blue,#246bfd)] flex items-center justify-center text-white shrink-0">
                                            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><circle cx="11" cy="11" r="8"></circle><line x1="21" y1="21" x2="16.65" y2="16.65"></line></svg>
                                        </div>
                                        <div className="menu-label-group">
                                            <div className="menu-label text-[var(--c-action-blue,#246bfd)]">搜索: <span className="font-semibold text-[var(--c-text-title)]">{addQuery.trim()}</span></div>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}

                    {addResult === null && (
                        <div className="ui-empty">
                            <span className="menu-desc">该用户不存在</span>
                        </div>
                    )}

                    {addResult && !isSendingAdd && (
                        <div className="page-menu">
                            <div className="menu-group">
                                <div className="menu-item !items-start">
                                    <div className="add-friend-avatar">
                                        {addResult.avatar ? (
                                            <img src={addResult.avatar} className="w-full h-full object-cover" alt="" />
                                        ) : (
                                            <ChatFallbackAvatar />
                                        )}
                                    </div>
                                    <div className="menu-label-group">
                                        <div className="ts-18 font-bold text-[var(--c-text-title)] mb-1">{addResult.name || "UNNAMED"}</div>
                                        <div className="menu-desc">微信号: {addResult.wechatID || "N/A"}</div>
                                        <div className="menu-desc">个性签名: {addResult.persona ? addResult.persona.slice(0, 30) + (addResult.persona.length > 30 ? "..." : "") : "暂无"}</div>
                                    </div>
                                </div>
                            </div>
                            <button
                                onClick={() => setIsSendingAdd(true)}
                                className="ui-btn ui-btn-success w-full"
                            >
                                添加到通讯录
                            </button>
                        </div>
                    )}

                    {isSendingAdd && addResult && (
                        <div className="page-menu">
                            <p className="menu-group-desc mx-0">发送添加朋友申请</p>
                            <div className="menu-group">
                                <div className="menu-item !items-start">
                                    <textarea
                                        autoFocus
                                        value={greetingText}
                                        onChange={e => setGreetingText(e.target.value)}
                                        placeholder="输入打招呼信息..."
                                        className="ui-textarea ui-input-inline min-h-[60px]"
                                    />
                                    <button onClick={() => setGreetingText("")} className="ui-bare-btn text-[var(--c-icon)]">
                                        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M19 6.41L17.59 5 12 10.59 6.41 5 5 6.41 10.59 12 5 17.59 6.41 19 12 13.41 17.59 19 19 17.59 13.41 12z" /></svg>
                                    </button>
                                </div>
                            </div>
                            <div className="flex flex-col gap-3">
                                <button
                                    onClick={() => {
                                        // 1. Add to contacts
                                        addChatContact(addResult.id);
                                        clearRequestsForCharacter(addResult.id);
                                        dispatchFriendRequestUpdated();
                                        // 2. Create or get session
                                        const newSession = createOrGetSession(addResult.id);

                                        // Check if re-adding (session already has messages)
                                        const isReAdd = loadChatMessages(newSession.id).length > 0;

                                        // Resolve character-bound user identity
                                        const charIdentity = resolveUserIdentity(addResult.id, "chat");
                                        const userName = charIdentity?.name || identity?.name || "你";

                                        // 3. Insert system message(s)
                                        if (isReAdd) {
                                            // Re-add: single message with both lines for memory
                                            const charName = addResult.name || "用户";
                                            pushChatMessage({
                                                sessionId: newSession.id,
                                                role: "system",
                                                content: `${userName}向${charName}发起了好友申请\n${charName}通过了好友申请`,
                                                status: "sent"
                                            });
                                            // Set flag to trigger AI reply on chat room mount
                                            kvSet(PENDING_REPLY_PREFIX + newSession.id, "1");
                                        } else {
                                            pushChatMessage({
                                                sessionId: newSession.id,
                                                role: "system",
                                                content: `${userName}已添加了${addResult.name || "用户"}，现在可以开始聊天了。`,
                                                status: "sent"
                                            });
                                        }

                                        // 4. Insert user greeting message if any
                                        if (greetingText.trim()) {
                                            pushChatMessage({
                                                sessionId: newSession.id,
                                                role: "user",
                                                content: greetingText.trim(),
                                                status: "sent"
                                            });
                                        }

                                        // 6. Open Chat
                                        onSelectSession(newSession);
                                        setIsAddFriendOpen(false);
                                        setAddQuery("");
                                        setAddResult(undefined);
                                        setIsSendingAdd(false);
                                    }}
                                    className="ui-btn ui-btn-success w-full"
                                >
                                    发送
                                </button>
                                <button
                                    onClick={() => setIsSendingAdd(false)}
                                    className="ui-btn ui-btn-ghost w-full"
                                >
                                    取消
                                </button>
                            </div>
                        </div>
                    )}
                </PageShell>
                </div>
                </div>
            )}
        </div>
    );
}

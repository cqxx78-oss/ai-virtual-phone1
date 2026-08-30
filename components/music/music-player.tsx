// components/music/music-player.tsx — Full-screen immersive music player
// Two visual states: cover (ambient flowing background) and glow lyrics.
// A vinyl mode is kept as a switchable style for nostalgia.
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { pushNav } from "@/lib/navigation-stack";
import { useMusicPlayer, type PlayMode } from "@/lib/music-context";
import { scrollElementWithinContainer } from "@/lib/dom-scroll";
import { kvGet, kvSet } from "@/lib/kv-db";
import { extractCoverPalette, DEFAULT_COVER_PALETTE, type CoverPalette } from "@/lib/cover-color";
import {
    getUserPlaylists, addTracksToPlaylist, removeTracksFromPlaylist, getNeteasePlayInfo,
    isNeteaseConfigured, recordTrackPlaylist, removeTrackPlaylistRecord, getTrackPlaylistId,
    getNeteaseSongDetail,
    type NeteasePlaylist,
} from "@/lib/music-service";
import {
    loadAllTracks, updateTrackMeta, toggleLike,
    type MusicTrack,
} from "@/lib/music-storage";
import MusicArtistPage from "./music-artist";
import { loadMusicBg, playerBgStyle, MUSIC_BG_EVENT, type MusicBgConfig } from "@/lib/music-bg";

const PLAY_MODE_ICONS: Record<PlayMode, { svg: string; label: string }> = {
    sequence: {
        svg: `<path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>`,
        label: "顺序播放",
    },
    shuffle: {
        svg: `<path d="M18 4l3 3-3 3M18 14l3 3-3 3M3 7h3a5 5 0 0 1 5 5 5 5 0 0 0 5 5h5M21 7h-5a5 5 0 0 0-3.16 1.13M3 17h3a5 5 0 0 0 3.16-1.13" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/>`,
        label: "随机播放",
    },
    "repeat-one": {
        svg: `<path d="M17 2l4 4-4 4M3 11V9a4 4 0 0 1 4-4h14M7 22l-4-4 4-4M21 13v2a4 4 0 0 1-4 4H3" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" fill="none"/><text x="12" y="15" text-anchor="middle" fill="currentColor" font-size="8" font-weight="bold">1</text>`,
        label: "单曲循环",
    },
};

const WAVE_BAR_COUNT = 44;

/** Deterministic waveform heights per track so the bar shape is stable. */
function waveHeights(seedText: string): number[] {
    let seed = 0;
    for (let i = 0; i < seedText.length; i++) seed = (seed * 31 + seedText.charCodeAt(i)) % 100000;
    const heights: number[] = [];
    for (let i = 0; i < WAVE_BAR_COUNT; i++) {
        const v = Math.abs(Math.sin(seed * 0.37 + i * 0.9) * 0.6 + Math.sin(seed * 0.11 + i * 2.3) * 0.4);
        heights.push(6 + Math.round(v * 16));
    }
    return heights;
}

type PlayerStyle = "modern" | "vinyl";
type BodyView = "cover" | "lyrics";

export default function MusicPlayer() {
    const player = useMusicPlayer();
    const progressRef = useRef<HTMLDivElement>(null);
    const [isDragging, setIsDragging] = useState(false);
    const [dragTime, setDragTime] = useState(0);
    const [view, setView] = useState<BodyView>("cover");
    const [playerStyle, setPlayerStyle] = useState<PlayerStyle>(() =>
        (typeof window !== "undefined" && kvGet("music-player-style") === "vinyl") ? "vinyl" : "modern");
    const [showQueue, setShowQueue] = useState(false);
    const [allLocalTracks, setAllLocalTracks] = useState<MusicTrack[]>([]);

    const refreshLocalData = useCallback(() => {
        loadAllTracks().then(setAllLocalTracks);
    }, []);

    const [artistView, setArtistView] = useState<{ id: number; name: string } | null>(null);

    useEffect(() => {
        if (showQueue) refreshLocalData();
    }, [showQueue, refreshLocalData]);

    // 物理返回键：全屏播放器挂载时自动入栈一层，出栈时关闭播放器退回音乐列表
    useEffect(() => {
        return pushNav(() => {
            player.closeFullPlayer();
        }, "music:player");
    }, [player]);

    // 播放列表弹窗与歌手页入栈
    useEffect(() => {
        if (showQueue) {
            return pushNav(() => {
                setShowQueue(false);
            }, "music:playerQueue");
        }
    }, [showQueue]);

    useEffect(() => {
        if (artistView) {
            return pushNav(() => {
                setArtistView(null);
            }, "music:artistView");
        }
    }, [artistView]);
    const [palette, setPalette] = useState<CoverPalette>(DEFAULT_COVER_PALETTE);
    const [bgCfg, setBgCfg] = useState<MusicBgConfig>(() => loadMusicBg());

    useEffect(() => {
        const handleBgChange = () => setBgCfg(loadMusicBg());
        window.addEventListener(MUSIC_BG_EVENT, handleBgChange);
        return () => window.removeEventListener(MUSIC_BG_EVENT, handleBgChange);
    }, []);

    // kv cache hydrates asynchronously from IndexedDB — the initial read above
    // may run before it's ready, silently dropping the saved vinyl preference
    // and custom background. Re-read a few times until hydration has settled.
    useEffect(() => {
        const timers = [300, 1200, 3000].map(ms => setTimeout(() => {
            const stored = kvGet("music-player-style");
            if (stored === "vinyl" || stored === "modern") {
                setPlayerStyle(prev => (prev === stored ? prev : stored));
            }
            setBgCfg(prev => {
                const fresh = loadMusicBg();
                return JSON.stringify(prev) === JSON.stringify(fresh) ? prev : fresh;
            });
        }, ms));
        return () => timers.forEach(clearTimeout);
    }, []);
    const [musicToast, setMusicToast] = useState<string | null>(null);
    const [pendingPlayTrackId, setPendingPlayTrackId] = useState<string | null>(null);
    const musicToastTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
    const musicLoadingFallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    const currentTime = isDragging ? dragTime : player.currentTime;
    const progress = player.duration > 0 ? currentTime / player.duration : 0;

    const formatTime = (s: number) => {
        if (!s || !isFinite(s)) return "0:00";
        const m = Math.floor(s / 60);
        const sec = Math.floor(s % 60);
        return `${m}:${sec.toString().padStart(2, "0")}`;
    };

    const clearMusicToast = useCallback(() => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setMusicToast(null);
        setPendingPlayTrackId(null);
    }, []);

    const showMusicToast = useCallback((text: string, duration = 2000) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        musicLoadingFallbackRef.current = null;
        setPendingPlayTrackId(null);
        setMusicToast(text);
        if (duration > 0) {
            musicToastTimerRef.current = setTimeout(() => {
                setMusicToast(null);
                musicToastTimerRef.current = null;
            }, duration);
        }
    }, []);

    const beginMusicLoadingToast = useCallback((trackId: string) => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
        musicToastTimerRef.current = null;
        setPendingPlayTrackId(trackId);
        setMusicToast("加载音乐中...");
        musicLoadingFallbackRef.current = setTimeout(() => {
            setMusicToast(null);
            setPendingPlayTrackId(null);
            musicLoadingFallbackRef.current = null;
        }, 8000);
    }, []);

    useEffect(() => {
        if (!pendingPlayTrackId || player.currentTrack?.id !== pendingPlayTrackId) return;
        clearMusicToast();
    }, [clearMusicToast, pendingPlayTrackId, player.currentTrack?.id]);

    useEffect(() => () => {
        if (musicToastTimerRef.current) clearTimeout(musicToastTimerRef.current);
        if (musicLoadingFallbackRef.current) clearTimeout(musicLoadingFallbackRef.current);
    }, []);

    // ── Ambient palette from cover art ──
    const coverUrl = player.currentTrack?.coverUrl;
    useEffect(() => {
        let cancelled = false;
        extractCoverPalette(coverUrl).then(p => { if (!cancelled) setPalette(p); });
        return () => { cancelled = true; };
    }, [coverUrl]);

    // ── Track id parsing (kept for artist page + Netease branches) ──
    const isNeteaseTrack = player.currentTrack?.id?.startsWith("netease_") ?? false;
    const neteaseId = isNeteaseTrack ? parseInt(player.currentTrack!.id.replace("netease_", ""), 10) : 0;

    useEffect(() => {
        setArtistView(null);
    }, [player.currentTrack?.id]);

    const getTimeFromEvent = useCallback((clientX: number) => {
        const bar = progressRef.current;
        if (!bar || !player.duration) return 0;
        const rect = bar.getBoundingClientRect();
        const ratio = Math.max(0, Math.min(1, (clientX - rect.left) / rect.width));
        return ratio * player.duration;
    }, [player.duration]);

    const handleProgressDown = useCallback((e: React.PointerEvent) => {
        e.preventDefault();
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        const time = getTimeFromEvent(e.clientX);
        setDragTime(time);
        setIsDragging(true);
    }, [getTimeFromEvent]);

    const handleProgressMove = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        setDragTime(getTimeFromEvent(e.clientX));
    }, [isDragging, getTimeFromEvent]);

    const handleProgressUp = useCallback((e: React.PointerEvent) => {
        if (!isDragging) return;
        const time = getTimeFromEvent(e.clientX);
        setDragTime(time);
        player.seek(time);
        setIsDragging(false);
    }, [isDragging, getTimeFromEvent, player]);

    const cyclePlayMode = useCallback(() => {
        const modes: PlayMode[] = ["sequence", "shuffle", "repeat-one"];
        const idx = modes.indexOf(player.playMode);
        player.setPlayMode(modes[(idx + 1) % modes.length]);
    }, [player]);

    const togglePlayerStyle = useCallback(() => {
        setPlayerStyle(prev => {
            const next: PlayerStyle = prev === "modern" ? "vinyl" : "modern";
            try { kvSet("music-player-style", next); } catch { /* ignore */ }
            showMusicToast(next === "vinyl" ? "已切换为黑胶唱片样式" : "已切换为现代封面样式");
            return next;
        });
    }, [showMusicToast]);

    // ── Parse LRC lyrics ──
    const parsedLyrics = useRef<{ time: number; text: string }[]>([]);
    const [activeLyricIdx, setActiveLyricIdx] = useState(-1);
    const lyricsContainerRef = useRef<HTMLDivElement>(null);

    useEffect(() => {
        const lrc = player.currentTrack?.lyrics || "";
        if (!lrc) {
            parsedLyrics.current = [];
            return;
        }
        const lines: { time: number; text: string }[] = [];
        for (const line of lrc.split("\n")) {
            const match = line.match(/\[(\d+):(\d+(?:\.\d+)?)\](.*)/);
            if (match) {
                const mins = parseInt(match[1], 10);
                const secs = parseFloat(match[2]);
                lines.push({ time: mins * 60 + secs, text: match[3].trim() });
            }
        }
        lines.sort((a, b) => a.time - b.time);
        parsedLyrics.current = lines;
    }, [player.currentTrack?.lyrics]);

    useEffect(() => {
        const lyrics = parsedLyrics.current;
        if (lyrics.length === 0) { setActiveLyricIdx(-1); return; }
        let idx = -1;
        for (let i = lyrics.length - 1; i >= 0; i--) {
            if (player.currentTime >= lyrics[i].time) {
                idx = i;
                break;
            }
        }
        setActiveLyricIdx(idx);
    }, [player.currentTime]);

    // Auto-scroll lyrics
    useEffect(() => {
        if (view !== "lyrics" || activeLyricIdx < 0 || !lyricsContainerRef.current) return;
        const el = lyricsContainerRef.current.children[activeLyricIdx] as HTMLElement;
        if (el) scrollElementWithinContainer(lyricsContainerRef.current, el, { behavior: "smooth", block: "center" });
    }, [activeLyricIdx, view]);

    const handleLyricClick = useCallback((idx: number, e: React.MouseEvent) => {
        e.stopPropagation();
        const line = parsedLyrics.current[idx];
        if (line) player.seek(line.time);
    }, [player]);

    const [liked, setLiked] = useState(false);
    const [showPlaylistPicker, setShowPlaylistPicker] = useState(false);
    const [playlists, setPlaylists] = useState<NeteasePlaylist[]>([]);
    const [loadingPlaylists, setLoadingPlaylists] = useState(false);
    const [addResult, setAddResult] = useState<{ ok: boolean; message: string } | null>(null);

    // Sync liked state with current track
    useEffect(() => {
        setLiked(player.currentTrack?.liked ?? false);
    }, [player.currentTrack?.id, player.currentTrack?.liked]);

    // Clear add result after 2s
    useEffect(() => {
        if (!addResult) return;
        const t = setTimeout(() => setAddResult(null), 2000);
        return () => clearTimeout(t);
    }, [addResult]);

    const handleLike = useCallback(async () => {
        if (!player.currentTrack) return;
        const newLiked = !liked;
        setLiked(newLiked);
        // 如果是本地音乐，直接更新本地 DB 里的 liked 状态
        if (!isNeteaseTrack) {
            await updateTrackMeta(player.currentTrack.id, { liked: newLiked });
            window.dispatchEvent(new Event("music-library-updated"));
            showMusicToast(newLiked ? "已加入喜欢" : "已取消喜欢");
            return;
        }
        if (newLiked) {
            // For Netease tracks, open playlist picker to add to a playlist
            if (isNeteaseTrack && isNeteaseConfigured()) {
                setShowPlaylistPicker(true);
                setLoadingPlaylists(true);
                getUserPlaylists().then(p => { setPlaylists(p); setLoadingPlaylists(false); });
            }
        } else {
            // Unlike — remove from Netease playlist if previously added
            if (isNeteaseTrack && neteaseId) {
                const pid = getTrackPlaylistId(neteaseId);
                if (pid) {
                    const result = await removeTracksFromPlaylist(pid, [neteaseId]);
                    removeTrackPlaylistRecord(neteaseId);
                    setAddResult(result);
                }
            }
        }
    }, [liked, player.currentTrack, isNeteaseTrack, neteaseId, showMusicToast]);

    const handleAddToPlaylist = useCallback(async (playlist: NeteasePlaylist) => {
        if (!neteaseId) return;
        const result = await addTracksToPlaylist(playlist.id, [neteaseId]);
        if (result.ok) {
            recordTrackPlaylist(neteaseId, playlist.id);
        }
        setAddResult(result);
        setShowPlaylistPicker(false);
    }, [neteaseId]);

    const openShareViaChat = useCallback(() => {
        if (!player.currentTrack) return;
        window.dispatchEvent(new CustomEvent("open-mini-chat", {
            detail: { share: { type: "music", title: player.currentTrack.title, artist: player.currentTrack.artist } },
        }));
    }, [player.currentTrack]);

    const openMiniChat = useCallback(() => {
        window.dispatchEvent(new CustomEvent("open-mini-chat"));
    }, []);

    const openArtistPage = useCallback(async () => {
        if (!player.currentTrack) return;
        if (!isNeteaseTrack || !isNeteaseConfigured()) {
            showMusicToast("本地歌曲暂无歌手主页");
            return;
        }
        const detail = await getNeteaseSongDetail(neteaseId);
        const first = detail?.artistList?.[0];
        if (!first) {
            showMusicToast("没有找到歌手信息");
            return;
        }
        setArtistView(first);
    }, [player.currentTrack, isNeteaseTrack, neteaseId, showMusicToast]);

    const track = player.currentTrack;
    const waveBars = useMemo(() => waveHeights(track?.id || "lumen"), [track?.id]);

    const getAdjacentTrack = (direction: "prev" | "next") => {
        if (player.queue.length === 0 || !player.currentTrack) return null;
        const idx = player.queue.findIndex(t => t.id === player.currentTrack!.id);
        if (idx < 0) return null;
        if (player.playMode === "shuffle") {
            return player.queue[Math.floor(Math.random() * player.queue.length)] ?? null;
        }
        const offset = direction === "next" ? 1 : -1;
        const nextIdx = (idx + offset + player.queue.length) % player.queue.length;
        return player.queue[nextIdx] ?? null;
    };

    const handleSwitchToTrack = useCallback(async (target: typeof player.currentTrack) => {
        if (!target) return;
        if (target.id.startsWith("netease_")) {
            beginMusicLoadingToast(target.id);
            const nid = parseInt(target.id.replace("netease_", ""), 10);
            const info = await getNeteasePlayInfo(nid);
            if (!info.url) {
                showMusicToast(info.reason || "加载失败，请稍后重试", 2600);
                return;
            }
            player.playUrl(info.url, target);
            if (info.trial) showMusicToast("VIP 歌曲，当前播放 30 秒试听", 2600);
            return;
        }
        player.playTrack(target);
    }, [beginMusicLoadingToast, player, showMusicToast]);

    const handlePrev = useCallback(() => {
        const target = getAdjacentTrack("prev");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.prev();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    const handleNext = useCallback(() => {
        const target = getAdjacentTrack("next");
        if (target?.id.startsWith("netease_")) {
            void handleSwitchToTrack(target);
            return;
        }
        player.next();
        // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [handleSwitchToTrack, player]);

    if (!track) return null;

    const hasLyrics = parsedLyrics.current.length > 0;
    const modeInfo = PLAY_MODE_ICONS[player.playMode];
    const activeLyricText = activeLyricIdx >= 0 ? parsedLyrics.current[activeLyricIdx]?.text : "";
    const customBg = playerBgStyle(bgCfg);
    const ambientVars = {
        "--mp-c1": palette[0],
        "--mp-c2": palette[1],
        "--mp-c3": palette[2],
        ...(customBg || {}),
    } as React.CSSProperties;

    // 下滑退出手势支持
    const touchStartY = useRef(0);
    const touchCurrentY = useRef(0);

    const handleTouchStart = (e: React.TouchEvent) => {
        touchStartY.current = e.touches[0].clientY;
        touchCurrentY.current = e.touches[0].clientY;
    };

    const handleTouchMove = (e: React.TouchEvent) => {
        touchCurrentY.current = e.touches[0].clientY;
    };

    const handleTouchEnd = () => {
        const dy = touchCurrentY.current - touchStartY.current;
        // 从上往下滑动超过 70px 时收起全屏播放器并退回音乐列表
        if (dy > 70) {
            player.closeFullPlayer();
            // 确保音乐 App 界面处于打开状态（停留在音乐列表）
            window.dispatchEvent(new CustomEvent("open-app", { detail: { appId: "music" } }));
        }
    };

    return (
        <div
            className="music-player mp-lumen"
            style={ambientVars}
            onTouchStart={handleTouchStart}
            onTouchMove={handleTouchMove}
            onTouchEnd={handleTouchEnd}
        >
            {musicToast && (
                <div className="music-toast-overlay">
                    <div className="music-toast-chip">
                        {musicToast === "加载音乐中..." ? (
                            <span className="ui-loading-toast-content">
                                <span className="ui-loading-spinner" />
                                <span>{musicToast}</span>
                            </span>
                        ) : musicToast}
                    </div>
                </div>
            )}

            {/* Ambient flowing background tinted by cover colors (hidden on custom bg) */}
            <div className="mp-ambient" aria-hidden="true">
                {!customBg && (
                    <>
                        <i className="mp-blob mp-blob-1" />
                        <i className="mp-blob mp-blob-2" />
                        <i className="mp-blob mp-blob-3" />
                    </>
                )}
                <span className="mp-grain" />
                <span className="mp-vignette" />
            </div>

            {/* Header */}
            <div className="mp-top">
                <button className="music-player-close" onClick={player.closeFullPlayer}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M15 19 8 12l7-7" />
                    </svg>
                </button>
                <div className="mp-titles">
                    <div className="mp-song" {...(view === "lyrics" ? { "data-glow": "" } : {})}>{track.title}</div>
                    <button className="mp-artist" onClick={openArtistPage}>
                        {track.artist || "未知歌手"}
                        <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="m9 5 7 7-7 7" /></svg>
                    </button>
                </div>
                <div className="mp-top-actions">
                    <button
                        className="music-player-ctrl-btn mp-top-btn"
                        {...(liked ? { "data-liked": "" } : {})}
                        onClick={handleLike}
                        title={liked ? "取消喜欢" : "喜欢"}
                    >
                        {liked ? (
                            <svg width="19" height="19" viewBox="0 0 24 24" fill="#ff4757" stroke="#ff4757" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                        ) : (
                            <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                                <path d="M20.84 4.61a5.5 5.5 0 0 0-7.78 0L12 5.67l-1.06-1.06a5.5 5.5 0 0 0-7.78 7.78l1.06 1.06L12 21.23l7.78-7.78 1.06-1.06a5.5 5.5 0 0 0 0-7.78z" />
                            </svg>
                        )}
                    </button>
                    <button className="music-player-ctrl-btn mp-top-btn" onClick={togglePlayerStyle} title={playerStyle === "vinyl" ? "切换现代样式" : "切换黑胶样式"}>
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5">
                            <circle cx="12" cy="12" r="9" /><circle cx="12" cy="12" r="2.5" fill="currentColor" stroke="none" />
                        </svg>
                    </button>
                    <button className="music-player-ctrl-btn mp-top-btn" onClick={openMiniChat} title="聊天小窗">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                            <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z" />
                        </svg>
                    </button>
                    <button className="music-player-ctrl-btn mp-top-btn" onClick={openShareViaChat} title="分享到聊天">
                        <svg width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                            <circle cx="18" cy="5" r="3" /><circle cx="6" cy="12" r="3" /><circle cx="18" cy="19" r="3" />
                            <line x1="8.59" y1="13.51" x2="15.42" y2="17.49" /><line x1="15.41" y1="6.51" x2="8.59" y2="10.49" />
                        </svg>
                    </button>
                </div>
            </div>

            {/* Body — cover / vinyl / glow lyrics */}
            <div className="mp-body">
                {view === "lyrics" ? (
                    <div className="mp-lyrics-wrap" onClick={() => setView("cover")}>
                        {hasLyrics ? (
                            <div className="mp-lyrics" ref={lyricsContainerRef}>
                                {parsedLyrics.current.map((line, i) => {
                                    const dist = Math.abs(i - activeLyricIdx);
                                    return (
                                        <div
                                            key={i}
                                            className="mp-lyric-line"
                                            {...(i === activeLyricIdx ? { "data-active": "" } : dist === 1 ? { "data-near": "" } : {})}
                                            onClick={(e) => handleLyricClick(i, e)}
                                        >
                                            {line.text || " "}
                                        </div>
                                    );
                                })}
                            </div>
                        ) : (
                            <div className="mp-lyrics mp-lyrics-empty">
                                <div className="mp-lyric-line" data-active="">暂无歌词</div>
                            </div>
                        )}
                    </div>
                ) : playerStyle === "vinyl" ? (
                    <div className="music-player-vinyl-area" onClick={() => setView("lyrics")}>
                        <div className="music-player-vinyl-glow" />
                        <div className="music-player-vinyl" {...(player.isPlaying ? { "data-spinning": "" } : {})}>
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-1" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-2" />
                            <div className="music-player-vinyl-groove music-player-vinyl-groove-3" />
                            <div className="music-player-vinyl-center">
                                {track.coverUrl ? (
                                    <img src={track.coverUrl} alt="" className="music-player-vinyl-cover" />
                                ) : (
                                    <div className="music-player-vinyl-cover-placeholder">
                                        <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                            <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                        </svg>
                                    </div>
                                )}
                            </div>
                            <div className="music-player-vinyl-dot" />
                        </div>
                        <div className="music-player-tonearm" {...(player.isPlaying ? { "data-playing": "" } : {})}>
                            <div className="music-player-tonearm-pivot" />
                            <div className="music-player-tonearm-arm" />
                            <div className="music-player-tonearm-joint" />
                            <div className="music-player-tonearm-head" />
                        </div>
                    </div>
                ) : (
                    <div className="mp-cover-area" onClick={() => setView("lyrics")}>
                        <div className="mp-cover" {...(player.isPlaying ? {} : { "data-paused": "" })}>
                            {track.coverUrl ? (
                                <img src={track.coverUrl} alt="" />
                            ) : (
                                <div className="mp-cover-placeholder">
                                    <svg width="52" height="52" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1">
                                        <path d="M9 18V5l12-2v13" /><circle cx="6" cy="18" r="3" /><circle cx="18" cy="16" r="3" />
                                    </svg>
                                </div>
                            )}
                        </div>
                        <div className="mp-lyric-peek">
                            {activeLyricText ? (
                                <>「{activeLyricText}」<span>点击查看歌词</span></>
                            ) : hasLyrics ? (
                                <span>点击查看歌词</span>
                            ) : null}
                        </div>
                    </div>
                )}
            </div>

            {/* Waveform progress */}
            <div className="mp-progress-area">
                <div
                    ref={progressRef}
                    className="mp-wave"
                    onPointerDown={handleProgressDown}
                    onPointerMove={handleProgressMove}
                    onPointerUp={handleProgressUp}
                    onPointerCancel={handleProgressUp}
                >
                    {waveBars.map((h, i) => {
                        const lit = (i + 0.5) / WAVE_BAR_COUNT <= progress;
                        const head = Math.abs((i + 0.5) / WAVE_BAR_COUNT - progress) < 0.5 / WAVE_BAR_COUNT;
                        return <i key={i} style={{ height: `${h}px` }} {...(head ? { "data-head": "" } : lit ? { "data-lit": "" } : {})} />;
                    })}
                </div>
                <div className="mp-times">
                    <span>{formatTime(currentTime)}</span>
                    <span>{formatTime(player.duration)}</span>
                </div>
            </div>

            {/* Controls */}
            <div className="mp-controls">
                <button className="music-player-ctrl-btn mp-ctrl-side" onClick={cyclePlayMode} title={modeInfo.label}>
                    <svg width="20" height="20" viewBox="0 0 24 24" dangerouslySetInnerHTML={{ __html: modeInfo.svg }} />
                </button>
                <button className="music-player-ctrl-btn mp-ctrl" onClick={handlePrev}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 6h2v12H6zm3.5 6l8.5 6V6z" />
                    </svg>
                </button>
                <button className="music-player-ctrl-btn mp-ctrl-play" onClick={player.togglePlay}>
                    {player.isPlaying ? (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M6 4h4v16H6zm8 0h4v16h-4z" />
                        </svg>
                    ) : (
                        <svg width="30" height="30" viewBox="0 0 24 24" fill="currentColor">
                            <path d="M8 5v14l11-7z" />
                        </svg>
                    )}
                </button>
                <button className="music-player-ctrl-btn mp-ctrl" onClick={handleNext}>
                    <svg width="28" height="28" viewBox="0 0 24 24" fill="currentColor">
                        <path d="M6 18l8.5-6L6 6v12zm8.5 0h2V6h-2v12z" />
                    </svg>
                </button>
                <button
                    className="music-player-ctrl-btn mp-ctrl-side"
                    onClick={() => setShowQueue(true)}
                    disabled={player.queue.length === 0}
                    title="播放列表"
                >
                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round">
                        <path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01" />
                    </svg>
                </button>
            </div>



            {/* 当前播放歌曲所属分组的播放列表（中央弹窗，只读，固定顺序） */}
            {showQueue && (() => {
                if (isNeteaseTrack) {
                    return (
                        <div className="music-settings-modal-overlay" onClick={() => setShowQueue(false)}>
                            <div className="music-settings-modal-dialog" style={{ maxWidth: 320, padding: 20 }} onClick={e => e.stopPropagation()}>
                                <div style={{ fontSize: 'calc(13px*var(--app-text-scale,1))', color: 'var(--c-music-text)', textAlign: 'center' }}>
                                    网易云歌曲不在本地分组中
                                </div>
                                <div style={{ fontSize: 'calc(11px*var(--app-text-scale,1))', color: 'var(--c-music-accent)', textAlign: 'center', marginTop: 8 }}>
                                    请在主界面切换到「本地」标签查看分组
                                </div>
                                <div className="music-settings-actions" style={{ justifyContent: 'center', marginTop: 16 }}>
                                    <button className="music-settings-btn music-settings-btn-primary" onClick={() => setShowQueue(false)}>知道了</button>
                                </div>
                            </div>
                        </div>
                    );
                }

                // 确定所属分组：收藏 > 未分组 > 自定义分类
                const cat = track.category;
                const groupLabel = !cat ? "未分组" : cat;
                const displayedTracks = !cat
                    ? allLocalTracks.filter(t => !t.category)
                    : allLocalTracks.filter(t => t.category === cat);

                return (
                    <div className="music-settings-modal-overlay" onClick={() => setShowQueue(false)}>
                        <div className="music-settings-modal-dialog" style={{ maxWidth: 350, maxHeight: '78vh', display: 'flex', flexDirection: 'column' }} onClick={e => e.stopPropagation()}>
                            <div className="music-settings-header" style={{ padding: '16px 18px 10px' }}>
                                <h2 style={{ fontSize: 'calc(14px*var(--app-text-scale,1))', fontWeight: 600 }}>「{groupLabel}」分组</h2>
                                <button className="music-settings-close" onClick={() => setShowQueue(false)}>
                                    <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                                </button>
                            </div>

                            <div style={{ flex: 1, overflowY: 'auto', padding: '8px 14px 16px', display: 'flex', flexDirection: 'column', gap: 4 }}>
                                {displayedTracks.length === 0 ? (
                                    <div style={{ padding: '36px 0', textAlign: 'center', color: 'var(--c-music-accent)', fontSize: 'calc(11.5px*var(--app-text-scale,1))' }}>
                                        这个分组还没有歌曲
                                    </div>
                                ) : (
                                    displayedTracks.map((t, idx) => {
                                        const isCurrent = t.id === track.id;
                                        return (
                                            <div
                                                key={t.id}
                                                style={{
                                                    display: 'flex', alignItems: 'center', gap: 10, padding: '8px 10px', borderRadius: 10,
                                                    background: isCurrent ? 'var(--c-music-primary-dim)' : 'transparent',
                                                    cursor: 'pointer',
                                                }}
                                                onClick={() => { void handleSwitchToTrack(t); }}
                                            >
                                                <span style={{ width: 18, fontSize: 'calc(10.5px*var(--app-text-scale,1))', color: isCurrent ? 'var(--c-music-primary)' : 'var(--c-music-accent)', textAlign: 'center' }}>
                                                    {idx + 1}
                                                </span>
                                                <div style={{ flex: 1, minWidth: 0 }}>
                                                    <div style={{ fontSize: 'calc(12px*var(--app-text-scale,1))', fontWeight: isCurrent ? 600 : 500, color: isCurrent ? 'var(--c-music-primary)' : 'var(--c-music-text)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {t.title}
                                                    </div>
                                                    <div style={{ fontSize: 'calc(9.5px*var(--app-text-scale,1))', color: 'var(--c-music-accent)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                                                        {t.artist}
                                                    </div>
                                                </div>
                                                {isCurrent && player.isPlaying && (
                                                    <div className="music-wave music-queue-wave" style={{ margin: '0 4px' }}>
                                                        {[0, 1, 2].map(i => <span key={i} className="music-wave-bar" style={{ animationDelay: `${i * 0.15}s` }} />)}
                                                    </div>
                                                )}
                                            </div>
                                        );
                                    })
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {/* Playlist picker overlay */}
            {showPlaylistPicker && (
                <div className="music-playlist-picker-overlay" onClick={() => setShowPlaylistPicker(false)}>
                    <div className="music-playlist-picker" onClick={e => e.stopPropagation()}>
                        <div className="music-playlist-picker-header">
                            <span>收藏到歌单</span>
                            <button className="music-playlist-picker-close" onClick={() => setShowPlaylistPicker(false)}>
                                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round"><line x1="18" y1="6" x2="6" y2="18" /><line x1="6" y1="6" x2="18" y2="18" /></svg>
                            </button>
                        </div>
                        <div className="music-playlist-picker-list">
                            {loadingPlaylists ? (
                                <div className="music-playlist-picker-loading">加载歌单...</div>
                            ) : playlists.length === 0 ? (
                                <div className="music-playlist-picker-loading">没有找到歌单</div>
                            ) : playlists.map(pl => (
                                <button key={pl.id} className="music-playlist-picker-item" onClick={() => handleAddToPlaylist(pl)}>
                                    <img src={pl.coverUrl} alt="" className="music-playlist-picker-cover" />
                                    <div className="music-playlist-picker-info">
                                        <div className="music-playlist-picker-name">{pl.name}</div>
                                        <div className="music-playlist-picker-count">{pl.trackCount}首</div>
                                    </div>
                                </button>
                            ))}
                        </div>
                    </div>
                </div>
            )}

            {/* Artist overlay */}
            {artistView && (
                <MusicArtistPage
                    artistId={artistView.id}
                    artistName={artistView.name}
                    onClose={() => setArtistView(null)}
                />
            )}

            {/* Add result toast */}
            {addResult && (
                <div className={`music-toast ${addResult.ok ? "music-toast-ok" : "music-toast-err"}`}>
                    {addResult.ok ? "✓ " : "✗ "}{addResult.message}
                </div>
            )}

        </div>
    );
}

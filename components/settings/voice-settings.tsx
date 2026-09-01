"use client";

import { useState, useEffect, useRef, useCallback, useContext } from "react";
import { Plus, Play, Pause, AlertCircle, RefreshCw, FileEdit, Trash2, X, Check, Upload, List, Star } from "lucide-react";
import { SettingsContext } from "./settings-context";
import type { VoiceApiConfig } from "@/lib/settings-types";
import { loadVoiceConfigs, saveVoiceConfigs } from "@/lib/settings-storage";
import { synthesizeSpeech } from "@/lib/tts-service";
import { ConfirmDialog } from "@/components/ui/modal";
import { Toggle, Input } from "@/components/ui/form";
import { Alert } from "@/components/ui/feedback";

const SUPPORTED_VOICE_PROVIDERS = new Set(["Minimax", "OpenAI"]);
const MINIMAX_BASE_URL_OPTIONS = [
    { id: "cn", label: "国内版", baseUrl: "https://api.minimaxi.com/v1" },
    { id: "global", label: "海外版", baseUrl: "https://api.minimax.io/v1" },
];
const DEFAULT_MINIMAX_BASE_URL = MINIMAX_BASE_URL_OPTIONS[0].baseUrl;
const GLOBAL_MINIMAX_BASE_URL = MINIMAX_BASE_URL_OPTIONS[1].baseUrl;
const MINIMAX_SPEED_MIN = 0.5;
const MINIMAX_SPEED_MAX = 2.0;
const MINIMAX_SPEED_STEP = 0.1;
const DEFAULT_SPEECH_SPEED = 1.0;
// Minimax voice_setting.pitch：半音，官方范围 ±12，0 为原声
const MINIMAX_PITCH_MIN = -12;
const MINIMAX_PITCH_MAX = 12;
const MINIMAX_PITCH_STEP = 1;
const DEFAULT_SPEECH_PITCH = 0;
const VOICE_PROVIDER_OPTIONS = [
    { value: "OpenAI", label: "OpenAI TTS" },
    { value: "MinimaxCN", label: "Minimax 语音国内版" },
    { value: "MinimaxGlobal", label: "Minimax 语音海外版" },
];

const DEFAULT_VOICE_CONFIGS: VoiceApiConfig[] = [
    {
        id: "default-minimax-tts",
        name: "Minimax 语音",
        provider: "Minimax",
        apiKey: "",
        baseUrl: DEFAULT_MINIMAX_BASE_URL,
        model: "speech-2.8-turbo",
        defaultVoice: "male-qn-qingse",
        speechSpeed: DEFAULT_SPEECH_SPEED,
        speechPitch: DEFAULT_SPEECH_PITCH,
        enableSTT: true,
        enableTTS: true,
    }
];

const DEFAULT_MINIMAX_MODELS = [
    { id: "speech-2.8-hd", name: "speech-2.8-hd" },
    { id: "speech-2.8-turbo", name: "speech-2.8-turbo" },
    { id: "speech-2.6-hd", name: "speech-2.6-hd" },
    { id: "speech-2.6-turbo", name: "speech-2.6-turbo" },
    { id: "speech-02-hd", name: "speech-02-hd" },
    { id: "speech-02-turbo", name: "speech-02-turbo" },
    { id: "speech-01-hd", name: "speech-01-hd" },
    { id: "speech-01-turbo", name: "speech-01-turbo (速度快/性价比高)" },
];

const MINIMAX_LANGUAGE_OPTIONS = [
    { value: "", label: "不指定（保持默认）" },
    { value: "auto", label: "自动识别" },
    { value: "Chinese", label: "普通话" },
    { value: "Chinese,Yue", label: "粤语" },
    { value: "English", label: "英语" },
    { value: "Arabic", label: "阿拉伯语" },
    { value: "Russian", label: "俄语" },
    { value: "Spanish", label: "西班牙语" },
    { value: "French", label: "法语" },
    { value: "Portuguese", label: "葡萄牙语" },
    { value: "German", label: "德语" },
    { value: "Turkish", label: "土耳其语" },
    { value: "Dutch", label: "荷兰语" },
    { value: "Ukrainian", label: "乌克兰语" },
    { value: "Vietnamese", label: "越南语" },
    { value: "Indonesian", label: "印尼语" },
    { value: "Japanese", label: "日语" },
    { value: "Italian", label: "意大利语" },
    { value: "Korean", label: "韩语" },
    { value: "Thai", label: "泰语" },
    { value: "Polish", label: "波兰语" },
    { value: "Romanian", label: "罗马尼亚语" },
    { value: "Greek", label: "希腊语" },
    { value: "Czech", label: "捷克语" },
    { value: "Finnish", label: "芬兰语" },
    { value: "Hindi", label: "印地语" },
    { value: "Bulgarian", label: "保加利亚语" },
    { value: "Danish", label: "丹麦语" },
    { value: "Hebrew", label: "希伯来语" },
    { value: "Malay", label: "马来语" },
    { value: "Persian", label: "波斯语" },
    { value: "Slovak", label: "斯洛伐克语" },
    { value: "Swedish", label: "瑞典语" },
    { value: "Croatian", label: "克罗地亚语" },
    { value: "Filipino", label: "菲律宾语" },
    { value: "Hungarian", label: "匈牙利语" },
    { value: "Norwegian", label: "挪威语" },
    { value: "Slovenian", label: "斯洛文尼亚语" },
    { value: "Catalan", label: "加泰罗尼亚语" },
    { value: "Nynorsk", label: "新挪威语" },
    { value: "Tamil", label: "泰米尔语" },
    { value: "Afrikaans", label: "南非荷兰语" },
];

const MINIMAX_PREVIEW_TEXT: Record<string, string> = {
    Chinese: "你好，很高兴认识你。这是一段普通话试听。",
    "Chinese,Yue": "大家好，我而家用紧粤语同你讲话，好开心认识你。",
    English: "Hello, it is nice to meet you. This is an English voice preview.",
    Arabic: "مرحبا، سعيد بلقائك. هذا اختبار صوتي باللغة العربية.",
    Russian: "Здравствуйте, приятно познакомиться. Это пример русской речи.",
    Spanish: "Hola, mucho gusto. Esta es una prueba de voz en español.",
    French: "Bonjour, enchanté de vous rencontrer. Ceci est un aperçu de la voix française.",
    Portuguese: "Olá, prazer em conhecer você. Esta é uma prévia de voz em português.",
    German: "Hallo, schön Sie kennenzulernen. Dies ist eine deutsche Sprachprobe.",
    Turkish: "Merhaba, tanıştığımıza memnun oldum. Bu bir Türkçe ses denemesidir.",
    Dutch: "Hallo, leuk u te ontmoeten. Dit is een Nederlandse stemtest.",
    Ukrainian: "Вітаю, приємно познайомитися. Це приклад українського мовлення.",
    Vietnamese: "Xin chào, rất vui được gặp bạn. Đây là bản nghe thử tiếng Việt.",
    Indonesian: "Halo, senang bertemu dengan Anda. Ini adalah contoh suara bahasa Indonesia.",
    Japanese: "こんにちは、はじめまして。これは日本語の音声サンプルです。",
    Italian: "Ciao, piacere di conoscerti. Questa è una prova vocale in italiano.",
    Korean: "안녕하세요, 만나서 반갑습니다. 한국어 음성 미리 듣기입니다.",
    Thai: "สวัสดี ยินดีที่ได้รู้จัก นี่คือตัวอย่างเสียงภาษาไทย",
    Polish: "Dzień dobry, miło mi cię poznać. To jest polska próbka głosu.",
    Romanian: "Bună, îmi pare bine să vă cunosc. Aceasta este o mostră de voce în limba română.",
    Greek: "Γεια σας, χαίρομαι που σας γνωρίζω. Αυτό είναι ένα δείγμα ελληνικής φωνής.",
    Czech: "Dobrý den, těší mě. Toto je ukázka českého hlasu.",
    Finnish: "Hei, hauska tavata. Tämä on suomenkielinen ääninäyte.",
    Hindi: "नमस्ते, आपसे मिलकर खुशी हुई। यह हिंदी आवाज़ का नमूना है।",
    Bulgarian: "Здравейте, приятно ми е да се запознаем. Това е пример за български глас.",
    Danish: "Hej, rart at møde dig. Dette er en dansk stemmeprøve.",
    Hebrew: "שלום, נעים להכיר. זוהי דוגמת קול בעברית.",
    Malay: "Helo, gembira bertemu dengan anda. Ini ialah contoh suara bahasa Melayu.",
    Persian: "سلام، از آشنایی با شما خوشحالم. این یک نمونه صدای فارسی است.",
    Slovak: "Dobrý deň, teší ma. Toto je ukážka slovenského hlasu.",
    Swedish: "Hej, trevligt att träffas. Det här är ett svenskt röstprov.",
    Croatian: "Pozdrav, drago mi je. Ovo je primjer hrvatskog glasa.",
    Filipino: "Kumusta, ikinagagalak kitang makilala. Ito ay halimbawa ng boses sa Filipino.",
    Hungarian: "Üdvözlöm, örülök, hogy találkoztunk. Ez egy magyar hangminta.",
    Norwegian: "Hei, hyggelig å møte deg. Dette er en norsk stemmeprøve.",
    Slovenian: "Pozdravljeni, veseli me. To je primer slovenskega glasu.",
    Catalan: "Hola, encantat de conèixer-te. Aquesta és una mostra de veu en català.",
    Nynorsk: "Hei, hyggeleg å møte deg. Dette er ei nynorsk stemmeprøve.",
    Tamil: "வணக்கம், உங்களைச் சந்தித்ததில் மகிழ்ச்சி. இது ஒரு தமிழ் குரல் மாதிரி.",
    Afrikaans: "Hallo, aangename kennis. Dit is 'n Afrikaanse stemvoorbeeld.",
};

const DEFAULT_MINIMAX_VOICES: VoiceOption[] = [
    // ── 普通话系统音色（男女青年、情绪、角色、播音、特色） ──
    { id: "male-qn-qingse", name: "青涩青年音 (male-qn-qingse)", category: "system" },
    { id: "male-qn-badao", name: "霸道青年音 (male-qn-badao)", category: "system" },
    { id: "male-qn-daxuesheng", name: "青年大学生 (male-qn-daxuesheng)", category: "system" },
    { id: "female-shaonv", name: "少女音 (female-shaonv)", category: "system" },
    { id: "female-yujie", name: "御姐音 (female-yujie)", category: "system" },
    { id: "female-chengshu", name: "成熟女性 (female-chengshu)", category: "system" },
    { id: "female-tianmei", name: "甜美女生 (female-tianmei)", category: "system" },
    { id: "female-chengshu-jingpin", name: "成熟女性音色-beta (female-chengshu-jingpin)", category: "system" },
    { id: "Wise_Woman", name: "知性女音 (Wise_Woman)", category: "system" },
    { id: "Friendly_Person", name: "亲切和蔼 (Friendly_Person)", category: "system" },
    { id: "Calm_Woman", name: "冷静女音 (Calm_Woman)", category: "system" },
    { id: "Warm_Man", name: "温暖男声 (Warm_Man)", category: "system" },
    { id: "Empathetic_Man", name: "共情男声 (Empathetic_Man)", category: "system" },
    { id: "Deep_Man", name: "深沉男声 (Deep_Man)", category: "system" },
    { id: "Inspiring_Man", name: "励志男声 (Inspiring_Man)", category: "system" },
    { id: "Lively_Girl", name: "活泼女孩 (Lively_Girl)", category: "system" },
    { id: "Sweet_Girl", name: "甜美女孩 (Sweet_Girl)", category: "system" },
    { id: "Cute_Girl", name: "可爱女孩 (Cute_Girl)", category: "system" },
    { id: "Charming_Lady", name: "魅力女声 (Charming_Lady)", category: "system" },
    { id: "Elegant_Lady", name: "优雅女声 (Elegant_Lady)", category: "system" },
    { id: "News_Anchor_Male", name: "男声新闻播音 (News_Anchor_Male)", category: "system" },
    { id: "News_Anchor_Female", name: "女声新闻播音 (News_Anchor_Female)", category: "system" },
    { id: "Audiobook_Male_1", name: "男声有声书 1 (Audiobook_Male_1)", category: "system" },
    { id: "Audiobook_Male_2", name: "男声有声书 2 (Audiobook_Male_2)", category: "system" },
    { id: "Audiobook_Female_1", name: "女声有声书 1 (Audiobook_Female_1)", category: "system" },
    { id: "Audiobook_Female_2", name: "女声有声书 2 (Audiobook_Female_2)", category: "system" },
    { id: "Documentary_Male", name: "纪录片解说男声 (Documentary_Male)", category: "system" },
    { id: "Boy_Child", name: "小男孩 (Boy_Child)", category: "system" },
    { id: "Girl_Child", name: "小女孩 (Girl_Child)", category: "system" },
    { id: "Old_Man", name: "慈祥老爷爷 (Old_Man)", category: "system" },
    { id: "Old_Woman", name: "慈祥老奶奶 (Old_Woman)", category: "system" },
    { id: "moss_audio", name: "MOSS 特色音 (moss_audio)", category: "system" },

    // ── 粤语方言音色 ──
    { id: "Cantonese_GentleLady", name: "粤语-温柔女声 (Cantonese_GentleLady)", category: "system" },
    { id: "Cantonese_PlayfulMan", name: "粤语-活泼男声 (Cantonese_PlayfulMan)", category: "system" },
    { id: "Cantonese_CuteGirl", name: "粤语-可爱女孩 (Cantonese_CuteGirl)", category: "system" },
    { id: "Cantonese_KindWoman", name: "粤语-善良女声 (Cantonese_KindWoman)", category: "system" },
    { id: "Cantonese_MellowMan", name: "粤语-沉稳男声 (Cantonese_MellowMan)", category: "system" },
    { id: "Cantonese_ProfessionalHost(F)", name: "粤语-专业女主持 (Cantonese_ProfessionalHost (F))", category: "system" },
    { id: "Cantonese_ProfessionalHost(M)", name: "粤语-专业男主持 (Cantonese_ProfessionalHost (M))", category: "system" },

    // ── 英语及外语音色 ──
    { id: "English_Gentle_Lady", name: "英语-温柔女声 (English_Gentle_Lady)", category: "system" },
    { id: "English_Deep_Man", name: "英语-深沉男声 (English_Deep_Man)", category: "system" },
    { id: "English_Expressive_Narrator", name: "英语-生动叙述者 (English_Expressive_Narrator)", category: "system" },
    { id: "Japanese_Anime_Girl", name: "日语-动漫少女 (Japanese_Anime_Girl)", category: "system" },
    { id: "Japanese_Calm_Man", name: "日语-沉稳男声 (Japanese_Calm_Man)", category: "system" },
];

const DEFAULT_OPENAI_VOICES = [
    { id: "alloy", name: "Alloy" },
    { id: "echo", name: "Echo" },
    { id: "fable", name: "Fable" },
    { id: "onyx", name: "Onyx" },
    { id: "nova", name: "Nova" },
    { id: "shimmer", name: "Shimmer" },
];

type VoiceOption = { id: string; name: string; createdAt?: number };

function uniqueOptions(options: VoiceOption[]): VoiceOption[] {
    const seen = new Set<string>();
    return options.filter(option => {
        if (!option.id || seen.has(option.id)) return false;
        seen.add(option.id);
        return true;
    });
}

function defaultVoiceOptions(provider: string): VoiceOption[] {
    return provider === "OpenAI" ? DEFAULT_OPENAI_VOICES : DEFAULT_MINIMAX_VOICES;
}

function voiceOptionsForConfig(config: VoiceApiConfig, fetchedVoices: Record<string, VoiceOption[]>): VoiceOption[] {
    return uniqueOptions([
        ...defaultVoiceOptions(config.provider),
        ...(config.customVoices || []),
        ...(fetchedVoices[config.id] || []),
    ]);
}

function normalizeVoiceConfigs(configs: VoiceApiConfig[]): VoiceApiConfig[] {
    return configs
        .filter(config => SUPPORTED_VOICE_PROVIDERS.has(config.provider))
        .map(config => {
            if (config.provider !== "Minimax") return config;
            const baseUrl = MINIMAX_BASE_URL_OPTIONS.some(option => option.baseUrl === config.baseUrl)
                ? config.baseUrl
                : DEFAULT_MINIMAX_BASE_URL;
            const speechSpeed = typeof config.speechSpeed === "number" && Number.isFinite(config.speechSpeed)
                ? Math.min(MINIMAX_SPEED_MAX, Math.max(MINIMAX_SPEED_MIN, config.speechSpeed))
                : DEFAULT_SPEECH_SPEED;
            const speechPitch = typeof config.speechPitch === "number" && Number.isFinite(config.speechPitch)
                ? Math.min(MINIMAX_PITCH_MAX, Math.max(MINIMAX_PITCH_MIN, Math.round(config.speechPitch)))
                : DEFAULT_SPEECH_PITCH;
            return { ...config, baseUrl, speechSpeed, speechPitch };
        });
}

function makeCloneVoiceId(config: VoiceApiConfig): string {
    const seed = (config.name || config.defaultVoice || "voice")
        .toLowerCase()
        .replace(/[^a-z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 24) || "voice";
    return `${seed}_${Date.now().toString(36)}`.slice(0, 64);
}

function providerSelectValue(config: VoiceApiConfig): string {
    if (config.provider === "OpenAI") return "OpenAI";
    return config.baseUrl === GLOBAL_MINIMAX_BASE_URL ? "MinimaxGlobal" : "MinimaxCN";
}

export function VoiceSettings() {
    const { setSubpageRightAction } = useContext(SettingsContext);
    const [configs, setConfigs] = useState<VoiceApiConfig[]>([]);
    const [editingId, setEditingId] = useState<string | null>(null);
    const [isNewConfig, setIsNewConfig] = useState(false);
    const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
    const [playingVoiceId, setPlayingVoiceId] = useState<string | null>(null);
    const [cloneTargetId, setCloneTargetId] = useState<string | null>(null);
    const [cloneVoiceId, setCloneVoiceId] = useState("");
    const [cloneFile, setCloneFile] = useState<File | null>(null);
    const [cloneError, setCloneError] = useState("");
    const [isCloning, setIsCloning] = useState(false);
    const [manualModelIds, setManualModelIds] = useState<Record<string, boolean>>({});
    const [manualVoiceIds, setManualVoiceIds] = useState<Record<string, boolean>>({});
    const [isLoaded, setIsLoaded] = useState(false);
    const [voicePickerTargetId, setVoicePickerTargetId] = useState<string | null>(null);
    const [activeCategoryTab, setActiveCategoryTab] = useState<string>("fav");
    const [favoriteVoices, setFavoriteVoices] = useState<string[]>(() => {
        if (typeof window === "undefined") return [];
        try {
            const raw = localStorage.getItem("favorite_voices_cache");
            return raw ? JSON.parse(raw) : [];
        } catch {
            return [];
        }
    });
    const audioRef = useRef<HTMLAudioElement | null>(null);

    const toggleFavoriteVoice = useCallback((voiceId: string) => {
        setFavoriteVoices(prev => {
            const next = prev.includes(voiceId) ? prev.filter(id => id !== voiceId) : [...prev, voiceId];
            try {
                localStorage.setItem("favorite_voices_cache", JSON.stringify(next));
            } catch { /* ignore */ }
            return next;
        });
    }, []);

    // Fetching states for Voices
    const [isFetching, setIsFetching] = useState<Record<string, boolean>>({});
    const [fetchedVoices, setFetchedVoices] = useState<Record<string, VoiceOption[]>>({});
    const [fetchError, setFetchError] = useState<Record<string, string>>({});

    // Load from localStorage on mount
    useEffect(() => {
        const stored = loadVoiceConfigs();
        const loaded = normalizeVoiceConfigs(stored);
        if (loaded.length > 0) {
            setConfigs(loaded);
            if (loaded.length !== stored.length) saveVoiceConfigs(loaded);
        } else {
            setConfigs(DEFAULT_VOICE_CONFIGS);
            saveVoiceConfigs(DEFAULT_VOICE_CONFIGS);
        }
        setIsLoaded(true);
    }, []);

    const persist = useCallback((newConfigs: VoiceApiConfig[]) => {
        setConfigs(newConfigs);
        saveVoiceConfigs(newConfigs);
    }, []);

    const addConfig = useCallback(() => {
        const newConfig: VoiceApiConfig = {
            id: `voice-${Date.now()}`,
            name: "新语音配置",
            provider: "Minimax",
            apiKey: "",
            baseUrl: DEFAULT_MINIMAX_BASE_URL,
            region: "",
            model: "speech-2.8-turbo",
            defaultVoice: "male-qn-qingse",
            speechSpeed: DEFAULT_SPEECH_SPEED,
            enableSTT: true,
            enableTTS: true,
        };
        persist([...configs, newConfig]);
        setIsNewConfig(true);
        setEditingId(newConfig.id);
    }, [configs, persist]);

    useEffect(() => {
        setSubpageRightAction("voice",
            <button
                onClick={addConfig}
                className="inline-flex h-10 items-center justify-center gap-1.5 whitespace-nowrap rounded-[20px] bg-black px-4 text-xs font-bold text-white shadow-sm transition-all hover:bg-gray-800 hover:shadow-md active:scale-95 focus:outline-none"
            >
                <Plus size={15} strokeWidth={1.8} />
                <span>新增语音方案</span>
            </button>
        );
        return () => setSubpageRightAction("voice", null);
    }, [addConfig, setSubpageRightAction]);

    const updateConfig = (id: string, updates: Partial<VoiceApiConfig>) => {
        persist(configs.map(c => c.id === id ? { ...c, ...updates } : c));
    };

    const updateProvider = (id: string, providerOption: string) => {
        const current = configs.find(c => c.id === id);
        if (providerOption === "OpenAI") {
            updateConfig(id, {
                provider: "OpenAI",
                baseUrl: "https://api.openai.com/v1",
                model: "tts-1",
                defaultVoice: "alloy",
            });
            setManualModelIds(prev => ({ ...prev, [id]: true }));
            setManualVoiceIds(prev => ({ ...prev, [id]: false }));
            return;
        }
        const wasMinimax = current?.provider === "Minimax";
        updateConfig(id, {
            provider: "Minimax",
            baseUrl: providerOption === "MinimaxGlobal" ? GLOBAL_MINIMAX_BASE_URL : DEFAULT_MINIMAX_BASE_URL,
            model: wasMinimax ? (current?.model || "speech-2.8-turbo") : "speech-2.8-turbo",
            defaultVoice: wasMinimax ? (current?.defaultVoice || "male-qn-qingse") : "male-qn-qingse",
            speechSpeed: wasMinimax ? (current?.speechSpeed ?? DEFAULT_SPEECH_SPEED) : DEFAULT_SPEECH_SPEED,
        });
        if (!wasMinimax) {
            setManualModelIds(prev => ({ ...prev, [id]: false }));
            setManualVoiceIds(prev => ({ ...prev, [id]: false }));
        }
    };

    const removeConfig = (id: string) => {
        persist(configs.filter(c => c.id !== id));

        // Cleanup states
        const newFetchedVoices = { ...fetchedVoices };
        delete newFetchedVoices[id];
        setFetchedVoices(newFetchedVoices);

        const newFetchError = { ...fetchError };
        delete newFetchError[id];
        setFetchError(newFetchError);

        setManualModelIds(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
        setManualVoiceIds(prev => {
            const next = { ...prev };
            delete next[id];
            return next;
        });
    };

    const openCloneModal = (config: VoiceApiConfig) => {
        setCloneTargetId(config.id);
        setCloneVoiceId(makeCloneVoiceId(config));
        setCloneFile(null);
        setCloneError("");
        setIsCloning(false);
    };

    const closeCloneModal = () => {
        if (isCloning) return;
        setCloneTargetId(null);
        setCloneVoiceId("");
        setCloneFile(null);
        setCloneError("");
    };

    const submitClone = async () => {
        const config = configs.find(c => c.id === cloneTargetId);
        if (!config) return;
        setCloneError("");
        const voiceId = cloneVoiceId.trim();
        if (!config.apiKey.trim()) {
            setCloneError("请先填写 Minimax API Key");
            return;
        }
        if (!voiceId || !/^[A-Za-z0-9_-]{4,64}$/.test(voiceId)) {
            setCloneError("Voice ID 只能包含英文、数字、下划线和连字符，长度 4-64");
            return;
        }
        if (!cloneFile) {
            setCloneError("请上传一段音频文件");
            return;
        }

        if (cloneFile.size > 20 * 1024 * 1024) {
            setCloneError("音频文件超过 20MB,请压缩后再试(30 秒左右的干净人声即可)");
            return;
        }

        setIsCloning(true);
        try {
            // 浏览器直连 MiniMax(和 TTS 同路),不走服务端中转:
            // 避开 Netlify 函数 ~6MB 请求体和 10s 超时限制,本地 dev 也不依赖出网代理。
            const base = (config.baseUrl || DEFAULT_MINIMAX_BASE_URL).replace(/\/$/, "");
            const auth = { Authorization: `Bearer ${config.apiKey.trim()}` };
            const readBaseRespError = (payload: Record<string, unknown> | null): string | null => {
                const baseResp = (payload?.base_resp ?? {}) as Record<string, unknown>;
                const code = baseResp.status_code ?? payload?.status_code;
                const message = String(baseResp.status_msg || payload?.status_msg || "");
                if (typeof code === "number" && code !== 0) return message || `status_code=${code}`;
                if (typeof code === "string" && code && code !== "0") return message || `status_code=${code}`;
                return null;
            };
            const parseJson = (text: string): Record<string, unknown> | null => {
                try { return JSON.parse(text) as Record<string, unknown>; } catch { return null; }
            };

            // 1) 上传克隆样本
            const uploadForm = new FormData();
            uploadForm.set("purpose", "voice_clone");
            uploadForm.set("file", cloneFile, cloneFile.name || "voice-sample.mp3");
            const uploadResponse = await fetch(`${base}/files/upload`, { method: "POST", headers: auth, body: uploadForm });
            const uploadText = await uploadResponse.text();
            const uploadData = parseJson(uploadText);
            const uploadError = readBaseRespError(uploadData);
            if (!uploadResponse.ok || uploadError) {
                throw new Error(uploadError || `样本上传失败 (HTTP ${uploadResponse.status}) ${uploadText.slice(0, 200)}`);
            }
            const fileRecord = (uploadData?.file ?? {}) as Record<string, unknown>;
            const fileId = fileRecord.file_id ?? uploadData?.file_id ?? uploadData?.id;
            if (fileId === undefined || fileId === null || fileId === "") {
                throw new Error(`上传结果里没有 file_id: ${uploadText.slice(0, 200)}`);
            }

            // 2) 发起克隆
            const cloneResponse = await fetch(`${base}/voice_clone`, {
                method: "POST",
                headers: { ...auth, "Content-Type": "application/json" },
                body: JSON.stringify({ file_id: fileId, voice_id: voiceId }),
            });
            const cloneText = await cloneResponse.text();
            const cloneData = parseJson(cloneText);
            const cloneRespError = readBaseRespError(cloneData);
            if (!cloneResponse.ok || cloneRespError) {
                throw new Error(cloneRespError || `克隆失败 (HTTP ${cloneResponse.status}) ${cloneText.slice(0, 200)}`);
            }
            const nextVoiceId = voiceId;
            const clonedVoice: VoiceOption = {
                id: nextVoiceId,
                name: `克隆音色 (${nextVoiceId})`,
                createdAt: Date.now(),
            };
            updateConfig(config.id, {
                defaultVoice: nextVoiceId,
                customVoices: uniqueOptions([clonedVoice, ...(config.customVoices || [])]),
            });
            setFetchedVoices(prev => {
                const current = prev[config.id] || [];
                return {
                    ...prev,
                    [config.id]: uniqueOptions([clonedVoice, ...current]),
                };
            });
            setCloneTargetId(null);
            setCloneVoiceId("");
            setCloneFile(null);
            setCloneError("");
            setManualVoiceIds(prev => ({ ...prev, [config.id]: false }));
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setCloneError(msg);
        } finally {
            setIsCloning(false);
        }
    };

    const fetchVoices = async (config: VoiceApiConfig) => {
        setIsFetching(prev => ({ ...prev, [config.id]: true }));
        setFetchError(prev => ({ ...prev, [config.id]: "" }));

        try {
            if (config.provider === "Minimax") {
                if (!config.apiKey.trim()) {
                    setFetchedVoices(prev => ({ ...prev, [config.id]: config.customVoices || [] }));
                    setFetchError(prev => ({ ...prev, [config.id]: "填写 API Key 后可同步账户已克隆音色" }));
                    return;
                }
                const response = await fetch("/api/voice/minimax-voices", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                        apiKey: config.apiKey,
                        baseUrl: config.baseUrl || DEFAULT_MINIMAX_BASE_URL,
                    }),
                });
                const data = await response.json().catch(() => ({}));
                if (!response.ok) {
                    throw new Error(data.message || data.error || `同步失败 (${response.status})`);
                }
                const clonedVoices = Array.isArray(data.voices) 
                    ? (data.voices as VoiceOption[]).map(v => ({ ...v, category: "official" })) 
                    : [];
                const nextCustomVoices = uniqueOptions([...clonedVoices, ...(config.customVoices || [])]);
                updateConfig(config.id, { customVoices: nextCustomVoices });
                setFetchedVoices(prev => ({ ...prev, [config.id]: nextCustomVoices }));

            } else if (config.provider === "OpenAI") {
                setFetchedVoices(prev => ({ ...prev, [config.id]: DEFAULT_OPENAI_VOICES }));
            } else {
                throw new Error("该服务商暂不支持拉取模型列表");
            }
        } catch (error: unknown) {
            const msg = error instanceof Error ? error.message : String(error);
            setFetchError(prev => ({ ...prev, [config.id]: msg }));
            setFetchedVoices(prev => ({ ...prev, [config.id]: [] }));
        } finally {
            setIsFetching(prev => ({ ...prev, [config.id]: false }));
        }
    };

    const togglePreview = async (config: VoiceApiConfig, specificVoiceId?: string) => {
        const playKey = specificVoiceId ? `${config.id}:${specificVoiceId}` : config.id;
        if (playingVoiceId === playKey) {
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current = null;
            }
            setPlayingVoiceId(null);
            return;
        }

        if (audioRef.current) {
            audioRef.current.pause();
            audioRef.current = null;
        }

        setPlayingVoiceId(playKey);

        try {
            const activeVoice = specificVoiceId || config.defaultVoice || "";
            let previewText = config.languageBoost && MINIMAX_PREVIEW_TEXT[config.languageBoost]
                ? MINIMAX_PREVIEW_TEXT[config.languageBoost]
                : "你好，很高兴认识你。这是一段语音试听。";

            if (activeVoice.startsWith("Cantonese_") || activeVoice.includes("粤语")) {
                previewText = MINIMAX_PREVIEW_TEXT["Chinese,Yue"];
            } else if (activeVoice.startsWith("Japanese_") || activeVoice.includes("日语")) {
                previewText = MINIMAX_PREVIEW_TEXT["Japanese"];
            } else if (activeVoice.startsWith("English_") || activeVoice.includes("英语")) {
                previewText = MINIMAX_PREVIEW_TEXT["English"];
            }

            const testConfig: VoiceApiConfig = specificVoiceId ? { ...config, defaultVoice: specificVoiceId } : config;
            const blob = await synthesizeSpeech(
                previewText,
                testConfig,
            );
            if (!blob) throw new Error("当前语音配置未返回真实音频");
            const url = URL.createObjectURL(blob);

            const audio = new Audio(url);
            audioRef.current = audio;
            audio.onended = () => {
                setPlayingVoiceId(null);
                audioRef.current = null;
                URL.revokeObjectURL(url);
            };
            audio.onerror = () => {
                setPlayingVoiceId(null);
                audioRef.current = null;
                URL.revokeObjectURL(url);
            };
            await audio.play();
        } catch (e: unknown) {
            const msg = e instanceof Error ? e.message : String(e);
            alert(`语音测试失败: ${msg}`);
            setPlayingVoiceId(null);
        }
    };

    if (!isLoaded) return null;

    return (
        <div className="flex flex-col gap-6">
            <div className="flex items-center">
                <h2 className="m-0 mx-2 ts-28 font-bold italic leading-none text-black">Voice API</h2>
            </div>

            {configs.length === 0 ? (
                <div className="ui-empty">
                    <div className="ui-icon-circle">
                        <Play size={24} />
                    </div>
                    <span className="menu-label font-semibold">没有语音配置</span>
                    <span className="menu-desc max-w-[240px]">
                        配置语音 API 以启用语音通话和回复播报。
                    </span>
                    <button onClick={addConfig} className="ui-btn ui-btn-primary rounded-[20px] mt-2">
                        <Plus size={16} /> 添加配置
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-2 gap-3">
                    {configs.map(config => (
                        <div
                            key={config.id}
                            className="ui-config-card min-w-0 cursor-pointer"
                            style={{ aspectRatio: "3 / 2", padding: "12px", justifyContent: "space-between" }}
                            role="button"
                            tabIndex={0}
                            aria-label={`编辑 ${config.name || config.provider}`}
                            onClick={() => setEditingId(config.id)}
                            onKeyDown={(event) => {
                                if (event.target !== event.currentTarget) return;
                                if (event.key === "Enter" || event.key === " ") {
                                    event.preventDefault();
                                    setEditingId(config.id);
                                }
                            }}
                        >
                            <div className="min-w-0 flex flex-col gap-1">
                                <span className="truncate text-[calc(14.4px*var(--app-text-scale,1))] font-bold leading-tight text-[var(--c-text-title)]">{config.name || config.provider}</span>
                                <span className="menu-desc truncate">{config.defaultVoice || config.model || config.provider || "未设置音色"}</span>
                            </div>
                            <div className="flex gap-2 shrink-0 items-center justify-end">
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setEditingId(config.id);
                                    }}
                                    className="ui-link-btn"
                                >
                                    <FileEdit size={18} />
                                </button>
                                <button
                                    type="button"
                                    onClick={(event) => {
                                        event.stopPropagation();
                                        setConfirmDeleteId(config.id);
                                    }}
                                    className="ui-link-btn"
                                    data-variant="danger"
                                >
                                    <Trash2 size={18} />
                                </button>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {editingId && (
                <div className="modal-overlay modal-overlay-bottom">
                    <div className="modal-sheet" data-ui="modal-sheet">
                        <div className="modal-header" data-ui="modal-header">
                            <button onClick={() => { if (isNewConfig && editingId) removeConfig(editingId); setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                            <span className="modal-header-title">{isNewConfig ? "添加语音配置" : "编辑语音配置"}</span>
                            <button onClick={() => { setIsNewConfig(false); setEditingId(null); }} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                        </div>

                        <div className="modal-body hide-scrollbar pb-10" data-ui="modal-body">
                            {(() => {
                                const config = configs.find(c => c.id === editingId);
                                if (!config) return null;
                                return (
                                    <div className="flex flex-col gap-4">
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">配置名称 (Name)</label>
                                            <Input
                                                type="text"
                                                value={config.name || ""}
                                                onChange={(e) => updateConfig(config.id, { name: e.target.value })}
                                                placeholder="例如: 我的语音助手"
                                            />
                                        </div>
                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">服务商 (Provider)</label>
                                            <select
                                                value={providerSelectValue(config)}
                                                onChange={(e) => updateProvider(config.id, e.target.value)}
                                                className="ui-select"
                                            >
                                                {VOICE_PROVIDER_OPTIONS.map(option => (
                                                    <option key={option.value} value={option.value}>{option.label}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">API Key</label>
                                            <Input
                                                type="password"
                                                value={config.apiKey}
                                                onChange={(e) => updateConfig(config.id, { apiKey: e.target.value })}
                                                placeholder="输入密钥..."
                                            />
                                        </div>
                                        {config.provider === "OpenAI" && (
                                            <>
                                                <div className="flex flex-col gap-1">
                                                    <label className="menu-desc ml-1">接口地址 (Base URL)</label>
                                                    <Input
                                                        type="text"
                                                        value={config.baseUrl || ""}
                                                        onChange={(e) => updateConfig(config.id, { baseUrl: e.target.value })}
                                                        placeholder="https://api.openai.com/v1"
                                                    />
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="menu-desc ml-1">语音模型 (TTS Model)</label>
                                                    {manualModelIds[config.id] ? (
                                                        <div className="flex gap-2">
                                                            <Input
                                                                type="text"
                                                                value={config.model || ""}
                                                                onChange={(e) => updateConfig(config.id, { model: e.target.value })}
                                                                placeholder="手动输入模型 ID"
                                                                className="flex-1"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setManualModelIds(prev => ({ ...prev, [config.id]: false }))}
                                                                className="ui-icon-btn"
                                                                aria-label="返回模型下拉选择"
                                                                title="返回模型下拉选择"
                                                            >
                                                                <List size={20} />
                                                            </button>
                                                        </div>
                                                    ) : (
                                                        <select
                                                            value={config.model === "tts-1" || config.model === "tts-1-hd" ? config.model : "__manual__"}
                                                            onChange={(e) => {
                                                                if (e.target.value === "__manual__") {
                                                                    setManualModelIds(prev => ({ ...prev, [config.id]: true }));
                                                                    return;
                                                                }
                                                                updateConfig(config.id, { model: e.target.value });
                                                            }}
                                                            className="ui-select"
                                                        >
                                                            <option value="tts-1">tts-1</option>
                                                            <option value="tts-1-hd">tts-1-hd</option>
                                                            <option value="__manual__">手动输入...</option>
                                                        </select>
                                                    )}
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="menu-desc ml-1">识别模型 (STT Model)</label>
                                                    <Input
                                                        type="text"
                                                        value={config.sttModel || ""}
                                                        onChange={(e) => updateConfig(config.id, { sttModel: e.target.value })}
                                                        placeholder="whisper-1（留空使用默认）"
                                                    />
                                                    <span className="menu-desc ml-1">通话「按住说话」用它把录音转成文字（非 iOS 设备生效），走同一个接口地址与密钥</span>
                                                </div>
                                            </>
                                        )}

                                        {config.provider === "Minimax" && (
                                            <>
                                                <div className="flex flex-col gap-1">
                                                    <div className="flex items-center justify-between px-1">
                                                        <label className="menu-desc">语速 (Speed)</label>
                                                        <span className="menu-label font-medium">{(config.speechSpeed ?? DEFAULT_SPEECH_SPEED).toFixed(1)}×</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min={MINIMAX_SPEED_MIN}
                                                        max={MINIMAX_SPEED_MAX}
                                                        step={MINIMAX_SPEED_STEP}
                                                        value={config.speechSpeed ?? DEFAULT_SPEECH_SPEED}
                                                        onChange={(e) => updateConfig(config.id, { speechSpeed: Number(e.target.value) })}
                                                        className="w-full accent-black"
                                                        aria-label="Minimax 语速"
                                                    />
                                                    <div className="relative h-4 px-1 text-xs text-gray-500" aria-hidden="true">
                                                        <span className="absolute left-1 whitespace-nowrap">{MINIMAX_SPEED_MIN.toFixed(1)}×</span>
                                                        <span className="absolute whitespace-nowrap" style={{ left: "33.333%", transform: "translateX(-50%)" }}>1.0× 默认</span>
                                                        <span className="absolute right-1 whitespace-nowrap">{MINIMAX_SPEED_MAX.toFixed(1)}×</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 -mt-1">
                                                    <div className="flex items-center justify-between px-1">
                                                        <label className="menu-desc">音调 (Pitch)</label>
                                                        <span className="menu-label font-medium">{config.speechPitch ?? DEFAULT_SPEECH_PITCH}</span>
                                                    </div>
                                                    <input
                                                        type="range"
                                                        min={MINIMAX_PITCH_MIN}
                                                        max={MINIMAX_PITCH_MAX}
                                                        step={MINIMAX_PITCH_STEP}
                                                        value={config.speechPitch ?? DEFAULT_SPEECH_PITCH}
                                                        onChange={(e) => updateConfig(config.id, { speechPitch: Number(e.target.value) })}
                                                        className="w-full accent-black"
                                                        aria-label="Minimax 音调"
                                                    />
                                                    <div className="relative h-4 px-1 text-xs text-gray-500" aria-hidden="true">
                                                        <span className="absolute left-1 whitespace-nowrap">{MINIMAX_PITCH_MIN}</span>
                                                        <span className="absolute whitespace-nowrap" style={{ left: "50%", transform: "translateX(-50%)" }}>0 默认</span>
                                                        <span className="absolute right-1 whitespace-nowrap">+{MINIMAX_PITCH_MAX}</span>
                                                    </div>
                                                </div>
                                                <div className="flex flex-col gap-1 mt-1">
                                                    <label className="menu-desc ml-1">朗读语言</label>
                                                    <select
                                                        value={config.languageBoost || ""}
                                                        onChange={(e) => updateConfig(config.id, { languageBoost: e.target.value || undefined })}
                                                        className="ui-select"
                                                    >
                                                        {MINIMAX_LANGUAGE_OPTIONS.map(option => (
                                                            <option key={option.value || "default"} value={option.value}>{option.label}</option>
                                                        ))}
                                                    </select>
                                                </div>
                                                <div className="flex flex-col gap-1">
                                                    <label className="menu-desc ml-1">语音模型 (TTS Model)</label>
                                                    <div className="flex flex-col gap-2">
                                                        {manualModelIds[config.id] ? (
                                                            <div className="flex gap-2">
                                                                <Input
                                                                    type="text"
                                                                    value={config.model || ""}
                                                                    onChange={(e) => updateConfig(config.id, { model: e.target.value })}
                                                                    placeholder="手动输入模型 ID"
                                                                    className="flex-1"
                                                                />
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setManualModelIds(prev => ({ ...prev, [config.id]: false }))}
                                                                    className="ui-icon-btn"
                                                                    aria-label="返回模型下拉选择"
                                                                    title="返回模型下拉选择"
                                                                >
                                                                    <List size={20} />
                                                                </button>
                                                            </div>
                                                        ) : (
                                                            <select
                                                                value={DEFAULT_MINIMAX_MODELS.some(m => m.id === config.model) ? config.model : "__manual__"}
                                                                onChange={(e) => {
                                                                    if (e.target.value === "__manual__") {
                                                                        setManualModelIds(prev => ({ ...prev, [config.id]: true }));
                                                                        return;
                                                                    }
                                                                    updateConfig(config.id, { model: e.target.value });
                                                                }}
                                                                className="ui-select"
                                                            >
                                                                {DEFAULT_MINIMAX_MODELS.map(model => (
                                                                    <option key={model.id} value={model.id}>{model.name}</option>
                                                                ))}
                                                                <option value="__manual__">手动输入...</option>
                                                            </select>
                                                        )}
                                                    </div>
                                                </div>
                                            </>
                                        )}

                                        <div className="flex flex-col gap-1">
                                            <label className="menu-desc ml-1">默认音色 (Default Voice) 或 自定义 Voice ID</label>
                                            <div className="flex flex-col gap-2">
                                                <div className="flex gap-2">
                                                    {manualVoiceIds[config.id] ? (
                                                        <>
                                                            <Input
                                                                type="text"
                                                                value={config.defaultVoice}
                                                                onChange={(e) => updateConfig(config.id, { defaultVoice: e.target.value })}
                                                                placeholder={config.provider === "OpenAI" ? "alloy" : "male-qn-qingse 或克隆 Voice ID"}
                                                                className="flex-1"
                                                            />
                                                            <button
                                                                type="button"
                                                                onClick={() => setManualVoiceIds(prev => ({ ...prev, [config.id]: false }))}
                                                                className="ui-icon-btn"
                                                                aria-label="打开音色选择面板"
                                                                title="打开音色选择面板"
                                                            >
                                                                <List size={20} />
                                                            </button>
                                                        </>
                                                    ) : (
                                                        (() => {
                                                            const options = voiceOptionsForConfig(config, fetchedVoices);
                                                            const currentOpt = options.find(v => v.id === config.defaultVoice);
                                                            const displayName = currentOpt ? currentOpt.name : (config.defaultVoice || "请选择音色");
                                                            return (
                                                                <button
                                                                    type="button"
                                                                    onClick={() => setVoicePickerTargetId(config.id)}
                                                                    className="ui-select flex-1 text-left flex items-center justify-between truncate"
                                                                >
                                                                    <span className="truncate">{displayName}</span>
                                                                    <span className="text-xs opacity-60 ml-2">切换</span>
                                                                </button>
                                                            );
                                                        })()
                                                    )}
                                                    <button
                                                        onClick={() => togglePreview(config)}
                                                        className="ui-icon-btn"
                                                        data-active={playingVoiceId === config.id}
                                                    >
                                                        {playingVoiceId === config.id ? <Pause size={20} /> : <Play size={20} />}
                                                    </button>
                                                </div>

                                                <div className="flex gap-2 mt-0.5">
                                                    <button
                                                        onClick={() => fetchVoices(config)}
                                                        disabled={isFetching[config.id]}
                                                        className="ui-btn ui-btn ui-btn-soft-action w-full"
                                                    >
                                                        <RefreshCw size={16} className={isFetching[config.id] ? "animate-spin" : ""} />
                                                        {isFetching[config.id] ? "同步中..." : config.provider === "Minimax" ? "同步音色列表" : "显示默认音色"}
                                                    </button>
                                                    {config.provider === "Minimax" && (
                                                        <button
                                                            onClick={() => openCloneModal(config)}
                                                            disabled={!config.apiKey.trim()}
                                                            className="ui-btn ui-btn-soft-action w-full"
                                                        >
                                                            <Upload size={16} />
                                                            上传音频克隆音色
                                                        </button>
                                                    )}
                                                </div>

                                                {fetchError[config.id] && (
                                                    <Alert variant="danger">
                                                        <AlertCircle size={14} />
                                                        {fetchError[config.id]}
                                                    </Alert>
                                                )}
                                            </div>
                                        </div>

                                        <div className="ui-toggle-row">
                                            <span className="menu-label font-medium">启用语音合成 (TTS)</span>
                                            <Toggle checked={config.enableTTS} onChange={(v) => updateConfig(config.id, { enableTTS: v })} />
                                        </div>
                                    </div>
                                )
                            })()}
                        </div>
                    </div>
                </div>
            )}

            {cloneTargetId && (() => {
                const config = configs.find(c => c.id === cloneTargetId);
                if (!config) return null;
                return (
                    <div className="modal-overlay">
                        <div className="modal-expand" data-ui="modal-dialog" style={{ width: "min(420px, calc(100% - 32px))", maxHeight: "82%" }}>
                            <div className="modal-header" data-ui="modal-header">
                                <button onClick={closeCloneModal} disabled={isCloning} className="modal-header-btn modal-header-btn-muted"><X size={18} /></button>
                                <span className="modal-header-title">克隆 Minimax 音色</span>
                                <button onClick={submitClone} disabled={isCloning} className="modal-header-btn modal-header-btn-action"><Check size={18} /></button>
                            </div>

                            <div className="modal-body hide-scrollbar" data-ui="modal-body">
                                <div className="flex flex-col gap-4">
                                    <div className="flex flex-col gap-1">
                                        <label className="menu-desc ml-1">新 Voice ID</label>
                                        <Input
                                            type="text"
                                            value={cloneVoiceId}
                                            onChange={(e) => setCloneVoiceId(e.target.value)}
                                            placeholder="例如 voice_xxx"
                                            disabled={isCloning}
                                        />
                                    </div>
                                    <div className="flex flex-col gap-1">
                                        <label className="menu-desc ml-1">音频样本</label>
                                        <input
                                            type="file"
                                            accept="audio/mpeg,audio/mp3,audio/mp4,audio/x-m4a,audio/wav,.mp3,.m4a,.wav"
                                            onChange={(e) => setCloneFile(e.target.files?.[0] || null)}
                                            disabled={isCloning}
                                            className="ui-input"
                                        />
                                        <span className="menu-desc ml-1">建议上传 10-30 秒、声音清晰、背景噪音少的音频。</span>
                                        <span className="ml-1 text-xs font-medium text-red-500">
                                            克隆音色初次使用将会扣除 9.9 元 Minimax token 费用（包含试听）。
                                        </span>
                                    </div>

                                    {cloneError && (
                                        <Alert variant="danger">
                                            <AlertCircle size={14} />
                                            {cloneError}
                                        </Alert>
                                    )}

                                    <button
                                        type="button"
                                        onClick={submitClone}
                                        disabled={isCloning}
                                        className="ui-btn ui-btn-primary w-full"
                                    >
                                        {isCloning ? <RefreshCw size={16} className="animate-spin" /> : <Upload size={16} />}
                                        {isCloning ? "正在克隆..." : "开始克隆并写入 Voice ID"}
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                );
            })()}

            {voicePickerTargetId && (() => {
                const targetConfig = configs.find(c => c.id === voicePickerTargetId);
                if (!targetConfig) return null;
                const options = voiceOptionsForConfig(targetConfig, fetchedVoices);

                const isMinimax = targetConfig.provider === "Minimax";
                const favorites = options.filter(v => favoriteVoices.includes(v.id));

                // Grouping for Minimax (严格按规则清洗与分流)
                const isCantoneseVoice = (v: VoiceOption) => v.id.startsWith("Cantonese_") || v.name.includes("粤语");
                const isForeignVoice = (v: VoiceOption) => v.id.includes("English") || v.id.includes("Japanese") || v.name.includes("英语") || v.name.includes("日语") || v.name.includes("外语");
                const hasChinese = (v: VoiceOption) => /[\u4e00-\u9fa5]/.test(v.name) || /[\u4e00-\u9fa5]/.test(v.id) || v.id.startsWith("male-") || v.id.startsWith("female-") || v.id.startsWith("Chinese");

                // 官方分组：作为独立标签，展示所有拉取到的官方模型
                const officialVoices = isMinimax ? options.filter(v => v.category === "official") : [];

                // 语言分组：不再与官方分组互斥，所有音色（内置+官方+自定义）都会被按语言分入对应的基础分组
                const cantoneseVoices = isMinimax ? options.filter(v => isCantoneseVoice(v)) : [];
                const foreignVoices = isMinimax ? options.filter(v => !cantoneseVoices.includes(v) && (isForeignVoice(v) || !hasChinese(v))) : [];
                const mandarinVoices = isMinimax ? options.filter(v => !cantoneseVoices.includes(v) && !foreignVoices.includes(v)) : options;

                const renderVoiceItem = (v: VoiceOption) => {
                    const isFav = favoriteVoices.includes(v.id);
                    const isSelected = targetConfig.defaultVoice === v.id;
                    const isThisPlaying = playingVoiceId === `${targetConfig.id}:${v.id}`;
                    return (
                        <div
                            key={v.id}
                            onClick={() => {
                                updateConfig(targetConfig.id, { defaultVoice: v.id });
                                setVoicePickerTargetId(null);
                            }}
                            className={`flex items-center justify-between px-3 py-2.5 rounded-xl cursor-pointer transition-colors ${
                                isSelected ? "bg-black/10 dark:bg-white/10 font-semibold" : "hover:bg-black/5 dark:hover:bg-white/5"
                            }`}
                        >
                            <div className="flex flex-col min-w-0 pr-2 flex-1">
                                <span className="text-xs md:text-sm truncate">{v.name}</span>
                                <span className="text-[10px] text-gray-400 truncate">{v.id}</span>
                            </div>
                            <div className="flex items-center gap-1 shrink-0" onClick={(e) => e.stopPropagation()}>
                                <button
                                    type="button"
                                    onClick={() => togglePreview(targetConfig, v.id)}
                                    className={`p-1.5 rounded-lg transition-colors ${
                                        isThisPlaying
                                            ? "bg-black/10 dark:bg-white/10 text-blue-500"
                                            : "hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200"
                                    }`}
                                    title={isThisPlaying ? "停止试听" : "试听音色"}
                                >
                                    {isThisPlaying ? <Pause size={16} /> : <Play size={16} />}
                                </button>
                                <button
                                    type="button"
                                    onClick={() => toggleFavoriteVoice(v.id)}
                                    className="p-1.5 rounded-lg hover:bg-black/10 dark:hover:bg-white/10 text-gray-400 hover:text-amber-500 transition-colors"
                                    title={isFav ? "取消收藏" : "收藏音色"}
                                >
                                    <Star
                                        size={16}
                                        className={isFav ? "fill-amber-400 text-amber-500" : "text-gray-400"}
                                    />
                                </button>
                            </div>
                        </div>
                    );
                };

                return (
                    <div className="modal-overlay z-50" onClick={() => setVoicePickerTargetId(null)}>
                        <div
                            className="modal-expand flex flex-col" style={{ width: "min(480px, calc(100% - 24px))", height: "min(540px, 80vh)" }}
                            data-ui="modal-dialog"
                            onClick={(e) => e.stopPropagation()}
                        >
                            <div className="modal-header" data-ui="modal-header">
                                <h3 className="modal-title">选择音色</h3>
                                <div className="flex items-center gap-2">
                                    <button
                                        type="button"
                                        onClick={() => {
                                            setManualVoiceIds(prev => ({ ...prev, [targetConfig.id]: true }));
                                            setVoicePickerTargetId(null);
                                        }}
                                        className="text-xs px-2.5 py-1 rounded-lg border border-black/10 dark:border-white/10 hover:bg-black/5"
                                    >
                                        手动填 ID
                                    </button>
                                    <button onClick={() => setVoicePickerTargetId(null)} className="modal-header-btn"><X size={18} /></button>
                                </div>
                            </div>

                            {isMinimax && (
                                <div className="flex items-center gap-1.5 px-4 py-2 border-b border-black/5 dark:border-white/5 overflow-x-auto hide-scrollbar shrink-0 bg-black/[0.02] dark:bg-white/[0.02]">
                                    {[
                                        { id: "fav", label: "收藏" },
                                        { id: "mandarin", label: "普通话" },
                                        { id: "cantonese", label: "粤语" },
                                        { id: "foreign", label: "外语" },
                                        ...(officialVoices.length > 0 ? [{ id: "official", label: "官方" }] : []),
                                    ].map(tab => (
                                        <button
                                            key={tab.id}
                                            type="button"
                                            onClick={() => setActiveCategoryTab(tab.id)}
                                            className={`px-3 py-1 text-xs rounded-full whitespace-nowrap transition-all font-medium ${
                                                activeCategoryTab === tab.id
                                                    ? "bg-black text-white dark:bg-white dark:text-black shadow-sm"
                                                    : "bg-black/5 dark:bg-white/5 text-gray-600 dark:text-gray-300 hover:bg-black/10 dark:hover:bg-white/10"
                                            }`}
                                        >
                                            {tab.label}
                                        </button>
                                    ))}
                                </div>
                            )}

                            <div className="modal-body flex-1 overflow-y-auto hide-scrollbar space-y-4 p-4" data-ui="modal-body">
                                {/* 常用收藏分组 */}
                                {activeCategoryTab === "fav" && (
                                    <div className="space-y-1.5">
                                        <div className="flex items-center justify-between px-1">
                                            <div className="text-xs font-bold text-gray-500 flex items-center gap-1">
                                                <Star size={13} className="fill-amber-500 text-amber-500" />
                                                <span>我的收藏</span>
                                            </div>
                                            <span className="text-xs text-gray-400">{favorites.length} 个</span>
                                        </div>
                                        {favorites.length > 0 ? (
                                            <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                                {favorites.map(renderVoiceItem)}
                                            </div>
                                        ) : (
                                            <div className="text-xs text-gray-400 italic px-3 py-2 bg-black/5 dark:bg-white/5 rounded-xl text-center">
                                                暂无收藏音色（点击右侧星星即可收藏）
                                            </div>
                                        )}
                                    </div>
                                )}
                                {isMinimax ? (
                                    <>
                                        {activeCategoryTab === "mandarin" && mandarinVoices.length > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="text-xs font-bold text-gray-500">🗣️ 普通话系统音色</div>
                                                    <span className="text-xs text-gray-400">{mandarinVoices.length} 个</span>
                                                </div>
                                                <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                                    {mandarinVoices.map(renderVoiceItem)}
                                                </div>
                                            </div>
                                        )}
                                        {activeCategoryTab === "cantonese" && cantoneseVoices.length > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="text-xs font-bold text-gray-500">🇭🇰 粤语方言音色</div>
                                                    <span className="text-xs text-gray-400">{cantoneseVoices.length} 个</span>
                                                </div>
                                                <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                                    {cantoneseVoices.map(renderVoiceItem)}
                                                </div>
                                            </div>
                                        )}
                                        {activeCategoryTab === "foreign" && foreignVoices.length > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="text-xs font-bold text-gray-500">🌐 外语音色</div>
                                                    <span className="text-xs text-gray-400">{foreignVoices.length} 个</span>
                                                </div>
                                                <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                                    {foreignVoices.map(renderVoiceItem)}
                                                </div>
                                            </div>
                                        )}
                                        {activeCategoryTab === "official" && officialVoices.length > 0 && (
                                            <div className="space-y-1.5">
                                                <div className="flex items-center justify-between px-1">
                                                    <div className="text-xs font-bold text-gray-500">🎙️ 官方接口获取音色</div>
                                                    <span className="text-xs text-gray-400">{officialVoices.length} 个</span>
                                                </div>
                                                <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                                    {officialVoices.map(renderVoiceItem)}
                                                </div>
                                            </div>
                                        )}
                                    </>
                                ) : (
                                    <div className="space-y-1.5">
                                        <div className="text-xs font-bold text-gray-500 px-1">全部可用音色</div>
                                        <div className="space-y-0.5 bg-black/5 dark:bg-white/5 rounded-2xl p-1">
                                            {options.map(renderVoiceItem)}
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    </div>
                );
            })()}

            {confirmDeleteId && (
                <ConfirmDialog
                    title="确认删除？"
                    message="删除配置后无法恢复。是否继续？"
                    icon={AlertCircle}
                    variant="danger"
                    confirmLabel="确认删除"
                    cancelLabel="取消"
                    onConfirm={() => {
                        removeConfig(confirmDeleteId);
                        setConfirmDeleteId(null);
                    }}
                    onCancel={() => setConfirmDeleteId(null)}
                />
            )}
        </div>
    );
}

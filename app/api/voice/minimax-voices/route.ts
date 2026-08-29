import { NextResponse } from "next/server";
import { proxyFetch } from "@/lib/proxy-fetch";

export const runtime = "nodejs";
export const maxDuration = 15;

const DEFAULT_MINIMAX_BASE_URL = "https://api.minimaxi.com/v1";

function normalizeBaseUrl(value: unknown): string {
    const raw = typeof value === "string" && value.trim() ? value.trim() : DEFAULT_MINIMAX_BASE_URL;
    return raw.replace(/\/$/, "");
}

function getRecord(value: unknown): Record<string, unknown> {
    return value && typeof value === "object" ? value as Record<string, unknown> : {};
}

function baseRespError(payload: unknown): string | null {
    const root = getRecord(payload);
    const baseResp = getRecord(root.base_resp);
    const code = baseResp.status_code ?? root.status_code;
    const message = String(baseResp.status_msg || root.status_msg || "");
    if (typeof code === "number" && code !== 0) return message || `status_code=${code}`;
    if (typeof code === "string" && code && code !== "0") return message || `status_code=${code}`;
    return null;
}

function formatVoiceName(item: Record<string, unknown>, voiceId: string, defaultPrefix = "音色"): string {
    const voiceName = typeof item.voice_name === "string" ? item.voice_name.trim() : "";
    if (voiceName) {
        return `${voiceName} (${voiceId})`;
    }
    const desc = Array.isArray(item.description)
        ? item.description.filter(Boolean).join(" ").trim()
        : (typeof item.description === "string" ? item.description.trim() : "");
    if (desc) {
        return `${desc.slice(0, 30)} (${voiceId})`;
    }
    return `${defaultPrefix} (${voiceId})`;
}

function parseCreatedTime(value: unknown): number | undefined {
    if (typeof value === "number") return value;
    if (typeof value === "string" && value.trim()) {
        const parsed = Date.parse(value);
        if (!Number.isNaN(parsed)) return parsed;
    }
    return undefined;
}

function extractAllVoices(payload: unknown): { id: string; name: string; createdAt?: number }[] {
    const root = getRecord(payload);
    const data = getRecord(root.data);

    const systemVoices = Array.isArray(root.system_voice) ? root.system_voice
        : Array.isArray(data.system_voice) ? data.system_voice : [];
    const clonedVoices = Array.isArray(root.voice_cloning) ? root.voice_cloning
        : Array.isArray(data.voice_cloning) ? data.voice_cloning : [];
    const genVoices = Array.isArray(root.voice_generation) ? root.voice_generation
        : Array.isArray(data.voice_generation) ? data.voice_generation : [];

    const result: { id: string; name: string; createdAt?: number }[] = [];
    const seen = new Set<string>();

    const appendItems = (list: unknown[], defaultPrefix: string) => {
        for (const item of list) {
            const record = getRecord(item);
            const rawVoiceId = record.voice_id ?? record.voiceId ?? record.id;
            if (typeof rawVoiceId !== "string" || !rawVoiceId.trim()) continue;
            const voiceId = rawVoiceId.trim();
            if (seen.has(voiceId)) continue;
            seen.add(voiceId);
            result.push({
                id: voiceId,
                name: formatVoiceName(record, voiceId, defaultPrefix),
                createdAt: parseCreatedTime(record.created_time),
            });
        }
    };

    appendItems(systemVoices, "系统音色");
    appendItems(clonedVoices, "克隆音色");
    appendItems(genVoices, "生成音色");

    return result;
}

export async function POST(request: Request) {
    try {
        return await handleGetVoices(request);
    } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return NextResponse.json({ error: "get_voice_failed", message: message.slice(0, 500) }, { status: 502 });
    }
}

async function handleGetVoices(request: Request) {
    const body = await request.json().catch(() => ({}));
    const apiKey = typeof body.apiKey === "string" ? body.apiKey.trim() : "";
    const baseUrl = normalizeBaseUrl(body.baseUrl);

    if (!apiKey) return NextResponse.json({ error: "missing_api_key" }, { status: 400 });

    const response = await proxyFetch(`${baseUrl}/get_voice`, {
        method: "POST",
        headers: {
            Authorization: `Bearer ${apiKey}`,
            "Content-Type": "application/json",
        },
        body: JSON.stringify({ voice_type: "all" }),
    });

    const text = await response.text();
    let data: unknown = null;
    try {
        data = JSON.parse(text);
    } catch {
        return NextResponse.json({ error: "upstream_not_json", message: text.slice(0, 500) }, { status: 502 });
    }

    const error = baseRespError(data);
    if (!response.ok || error) {
        return NextResponse.json(
            { error: "get_voice_failed", message: error || String(getRecord(data).message || text || `HTTP ${response.status}`).slice(0, 500) },
            { status: 502 },
        );
    }

    return NextResponse.json({ ok: true, voices: extractAllVoices(data) });
}

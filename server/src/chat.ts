import { ChatResponseBody, ChatTurn } from "./types";
import { matchDirectCommand, extractCommands } from "./commands";
import { askLlm } from "./llm";

const MAX_MESSAGE_LEN = 500;
const MAX_HISTORY_TURNS = 8;

export function isIdentifyIntent(text: string): boolean {
  if (!text) return false;
  return (
    /\b(identif[ty]+|identifying)\b.*\b(persons?|people|someone|anyone|human|individual|faces?|him|her|them|who|image|photo|picture)\b/i.test(text) ||
    /\b(who\s+is\s+(this|that|he|she))\b/i.test(text) ||
    /\b(recogni[sz]e|recogni[sz]ing)\b.*\b(persons?|people|someone|anyone|faces?|him|her|them|this|that)\b/i.test(text) ||
    /\b(do\s+you\s+know\s+(who|him|her|them|this\s+person))\b/i.test(text) ||
    /\b(facial\s+recognition|face\s+id)\b/i.test(text) ||
    /\b(open|show)\s+(the\s+)?(identify|upload|photo|image|face)\s*(panel|box|input)?\b/i.test(text) ||
    /\b(upload\s+(a\s+)?(photo|image|picture))\b/i.test(text)
  );
}

export async function handleChat(rawMessage: string, rawHistory: ChatTurn[] | undefined): Promise<ChatResponseBody> {
  const message = (rawMessage || "").trim().slice(0, MAX_MESSAGE_LEN);
  const history = Array.isArray(rawHistory) ? rawHistory.slice(-MAX_HISTORY_TURNS) : [];

  if (!message) {
    return { reply: "Sorry, could you say that again? I didn't quite catch it.", instructions: [], source: "fallback" };
  }

  // Reject echo if the incoming message matches the previous assistant response in history
  if (history.length > 0) {
    const lastAssistant = [...history].reverse().find((turn) => turn.role === "assistant");
    if (lastAssistant && lastAssistant.content) {
      const normalize = (s: string) => s.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
      const cleanMsg = normalize(message);
      const cleanPrev = normalize(lastAssistant.content);
      if (cleanMsg.length >= 6 && (cleanMsg === cleanPrev || cleanPrev.includes(cleanMsg))) {
        console.warn(`[chat] Rejected self-echo: "${message}" matches previous assistant reply.`);
        return { reply: "", instructions: [], source: "fallback" };
      }
    }
  }

  // 1. Instant, no-LLM fast path for wake-word imperatives ("Vision, dance").
  const direct = matchDirectCommand(message);
  if (direct) {
    return { reply: direct.reply, instructions: direct.instructions, source: "direct" };
  }

  // 2. Otherwise, hand it to the configured LLM and pull any command tags
  //    it chose to embed out of the reply, validating each one.
  console.log(`[chat] LLM request: "${message.slice(0, 80)}${message.length > 80 ? "…" : ""}"`);
  const result = await askLlm(message, history);
  if (!result.ok) {
    console.error(`[chat] LLM failed → ${result.text}`);
    return { reply: result.text, instructions: [], source: "fallback" };
  }

  const { text, instructions, action: parsedAction } = extractCommands(result.text);
  const action = parsedAction;

  console.log(`[chat] LLM ok (${instructions.length} cmd(s)): "${text.slice(0, 80)}${text.length > 80 ? "…" : ""}"`);
  return { reply: text || "…", instructions, source: "llm", ...(action ? { action } : {}) };
}

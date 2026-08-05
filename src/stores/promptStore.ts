import { create } from 'zustand';

export interface PromptOptions {
  title: string;
  /** 입력창 placeholder */
  placeholder?: string;
  /** 초기값 */
  defaultValue?: string;
  confirmLabel?: string;
  cancelLabel?: string;
}

interface PromptState {
  current: (PromptOptions & { resolve: (v: string | null) => void }) | null;
  /** 텍스트 입력 다이얼로그를 띄우고 입력값(취소 시 null)을 프라미스로 돌려준다 */
  prompt: (opts: PromptOptions) => Promise<string | null>;
  /** 다이얼로그 응답 처리 (확인 시 문자열, 취소 시 null) */
  respond: (v: string | null) => void;
}

export const usePromptStore = create<PromptState>((set, get) => ({
  current: null,
  prompt: (opts) =>
    new Promise<string | null>((resolve) => {
      // 이전 프롬프트가 떠 있으면 취소 처리하고 새 프롬프트로 교체
      const prev = get().current;
      if (prev) prev.resolve(null);
      set({ current: { ...opts, resolve } });
    }),
  respond: (v) => {
    const cur = get().current;
    if (!cur) return;
    cur.resolve(v);
    set({ current: null });
  },
}));

/** 스토어 밖에서도 호출 가능한 단축 함수 (window.prompt 대체 — Tauri WKWebView 미지원) */
export const promptText = (opts: PromptOptions) => usePromptStore.getState().prompt(opts);

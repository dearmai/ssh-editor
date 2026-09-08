import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import type { IndentRule } from '../utils/indent';

interface IndentStore {
  /** 파일별 들여쓰기 오버라이드 — `${서버}:${경로}` → 규칙 */
  byFile: Record<string, IndentRule>;
  setFileIndent: (key: string, rule: IndentRule) => void;
  clearFileIndent: (key: string) => void;
}

/**
 * 파일 단위 들여쓰기 오버라이드. 환경설정(확장자별 규칙)과 별개로 localStorage에 보관한다.
 * 상태바의 들여쓰기 버튼에서 바꾼 값이 여기에 쌓인다.
 */
export const useIndentStore = create<IndentStore>()(
  persist(
    (set) => ({
      byFile: {},
      setFileIndent: (key, rule) => set((s) => ({ byFile: { ...s.byFile, [key]: rule } })),
      clearFileIndent: (key) =>
        set((s) => {
          if (!(key in s.byFile)) return s;
          const byFile = { ...s.byFile };
          delete byFile[key];
          return { byFile };
        }),
    }),
    { name: 'ssh-editor-indent' }
  )
);

import type { ReactNode } from 'react';
import { create } from 'zustand';

export interface ConfirmOptions {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  cancelLabel?: string;
  /** 위험 동작(삭제 등)이면 확인 버튼을 빨간색으로 */
  danger?: boolean;
}

interface ConfirmState {
  current: (ConfirmOptions & { resolve: (v: boolean) => void }) | null;
  /** 확인 다이얼로그를 띄우고 결과(확인 true / 취소 false)를 프라미스로 돌려준다 */
  confirm: (opts: ConfirmOptions) => Promise<boolean>;
  /** 다이얼로그 응답 처리 */
  respond: (v: boolean) => void;
}

export const useConfirmStore = create<ConfirmState>((set, get) => ({
  current: null,
  confirm: (opts) =>
    new Promise<boolean>((resolve) => {
      // 이전 확인이 떠 있으면 취소 처리하고 새 확인으로 교체
      const prev = get().current;
      if (prev) prev.resolve(false);
      set({ current: { ...opts, resolve } });
    }),
  respond: (v) => {
    const cur = get().current;
    if (!cur) return;
    cur.resolve(v);
    set({ current: null });
  },
}));

/** 스토어 밖에서도 호출 가능한 단축 함수 */
export const confirm = (opts: ConfirmOptions) => useConfirmStore.getState().confirm(opts);

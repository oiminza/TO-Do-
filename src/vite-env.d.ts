/// <reference types="vite/client" />

interface ImportMetaEnv {
  /** [DEV 전용] "true"이면 저장 상태와 무관하게 온보딩을 강제 표시. 프로덕션 뱌드에서는 무시된다. */
  readonly VITE_DEV_FORCE_NEW_USER?: string;
}

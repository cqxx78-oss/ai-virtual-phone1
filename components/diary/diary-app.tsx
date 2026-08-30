"use client";

import { DiaryEntriesApp } from "./diary-entries-app";

type DiaryAppProps = {
  onClose: () => void;
  onNotice?: (message: string) => void;
};

export function DiaryApp({ onClose, onNotice }: DiaryAppProps) {
  return <DiaryEntriesApp onBack={onClose} onNotice={onNotice} />;
}

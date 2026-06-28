import { create } from "zustand";

export interface DiagnosticItem {
  from: number;
  to: number;
  severity: string;
  message: string;
  line: number;
}

interface ProblemsState {
  diagnostics: DiagnosticItem[];
  fileName: string;
  setDiagnostics: (diagnostics: DiagnosticItem[], fileName: string) => void;
  clearDiagnostics: () => void;
}

export const useProblemsStore = create<ProblemsState>((set) => ({
  diagnostics: [],
  fileName: "main.tex",
  setDiagnostics: (diagnostics, fileName) => set({ diagnostics, fileName }),
  clearDiagnostics: () => set({ diagnostics: [] }),
}));

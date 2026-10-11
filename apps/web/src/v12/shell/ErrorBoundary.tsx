import { Component } from "react";
import type { ErrorInfo, ReactNode } from "react";
import { RotateCw } from "lucide-react";
import { UnavailableNotice } from "../design/UnavailableNotice";

interface Props {
  /** Human name of the guarded region, e.g. "Evolution". */
  name: string;
  /** Change this to clear a caught error (e.g. the active workspace id). */
  resetKey?: string | number | null;
  children: ReactNode;
}

interface State {
  error: Error | null;
}

/** Contains a crash to one tab. The shell, scene and other tabs keep running. */
export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error(`[${this.props.name}] render error`, error, info.componentStack);
  }

  componentDidUpdate(prev: Props) {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    return (
      <div className="hud-pad pointer-events-none grid h-full place-items-center">
        <div className="pointer-events-auto w-[min(34rem,100%)]">
          <UnavailableNotice
            title={`${this.props.name} hit an unexpected error`}
            detail="This tab stopped rendering. Your saved workspace and any unsaved draft are untouched; they live outside this view."
            action={
              <div className="space-y-2">
                <button type="button" className="btn" onClick={() => this.setState({ error: null })}>
                  <RotateCw aria-hidden className="h-4 w-4" />
                  Reload this tab
                </button>
                <details className="text-xs text-fg-3">
                  <summary className="cursor-pointer text-fg-2">Technical detail</summary>
                  <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap break-words font-mono">{String(error.message)}</pre>
                </details>
              </div>
            }
          />
        </div>
      </div>
    );
  }
}

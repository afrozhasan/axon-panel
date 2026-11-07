import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button, Card } from "./ui";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught UI error caught by ErrorBoundary:", error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="flex h-full min-h-[400px] items-center justify-center p-6 bg-[var(--axon-bg)]">
          <Card className="max-w-lg p-6 bg-[var(--axon-card)] border-[var(--axon-border)] shadow-xl">
            <div className="flex items-center gap-3 pb-3 border-b border-[var(--axon-border)]">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-rose-500/15 text-rose-400 font-bold border border-rose-500/30">
                ✕
              </span>
              <div>
                <h2 className="text-sm font-bold text-[var(--axon-text)]">An unexpected interface error occurred</h2>
                <p className="text-[11px] text-[var(--axon-muted)]">Axon Panel caught an error and prevented a blank screen.</p>
              </div>
            </div>
            <div className="my-4 p-3 rounded-lg bg-[var(--axon-sidebar)] border border-[var(--axon-border)] font-mono text-xs text-rose-400 overflow-x-auto">
              {this.state.error?.message || "Unknown error"}
            </div>
            <div className="flex justify-end gap-2 pt-2 text-xs">
              <Button
                variant="outline"
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.href = "/";
                }}
              >
                Go to Dashboard
              </Button>
              <Button
                onClick={() => {
                  this.setState({ hasError: false, error: null });
                  window.location.reload();
                }}
                className="bg-[var(--axon-primary)] text-[var(--axon-primary-fg)] font-semibold"
              >
                Reload Page
              </Button>
            </div>
          </Card>
        </div>
      );
    }

    return this.props.children;
  }
}
